import type { Job, JobId, JobKind } from "@polyon/contracts";

import { JobQueue } from "./job-queue";
import { JobService } from "./job-service";

export interface JobHandlerContext {
  readonly job: Job;
  readonly signal: AbortSignal;
  readonly now: string;
}

export type JobHandler = (context: JobHandlerContext) => unknown | Promise<unknown>;

export type JobHandlers = Readonly<Partial<Record<JobKind, JobHandler>>>;

export interface JobRuntimeClock {
  now(): string;
}

export type JobRuntimeWait = (milliseconds: number) => Promise<void>;

export type JobRuntimeStatus = "STOPPED" | "RUNNING";

export interface JobRuntimeHealth {
  readonly status: JobRuntimeStatus;
  readonly queuedJobCount: number;
  readonly activeJobCount: number;
  readonly recoveredJobCount: number;
  readonly completedJobCount: number;
  readonly failedJobCount: number;
  readonly lastError?: string;
  readonly lastActivityAt?: string;
}

export interface JobRuntimeDependencies {
  readonly jobs: JobService;
  readonly handlers?: JobHandlers;
  readonly clock: JobRuntimeClock;
  readonly pollIntervalMs?: number;
  readonly maxConcurrency?: number;
  readonly retryBackoffInitialMs?: number;
  readonly retryBackoffMaxMs?: number;
  readonly wait?: JobRuntimeWait;
  readonly onError?: (error: unknown) => void;
  readonly onJobCompleted?: (job: Job) => void | Promise<void>;
}

export interface JobRuntime {
  readonly queue: JobQueue;
  readonly health: JobRuntimeHealth;
  readonly status: JobRuntimeStatus;
  readonly activeJobCount: number;
  start(): void;
  stop(): void;
  runNext(): Promise<Job | undefined>;
  drain(): Promise<readonly Job[]>;
  enqueue(jobId: JobId): void;
  cancel(jobId: JobId): Job | undefined;
}

const DEFAULT_POLL_INTERVAL_MS = 250;
const DEFAULT_MAX_CONCURRENCY = 1;
const DEFAULT_RETRY_BACKOFF_INITIAL_MS = 1_000;
const DEFAULT_RETRY_BACKOFF_MAX_MS = 60_000;

function defaultWait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function validatePositiveInteger(value: number, field: string): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new RangeError(`${field} must be a positive integer.`);
  }
}

function validateNonNegativeNumber(value: number, field: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${field} must be a finite non-negative number.`);
  }
}

export function createJobRuntime(dependencies: JobRuntimeDependencies): JobRuntime {
  const pollIntervalMs = dependencies.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const maxConcurrency = dependencies.maxConcurrency ?? DEFAULT_MAX_CONCURRENCY;
  const retryBackoffInitialMs =
    dependencies.retryBackoffInitialMs ?? DEFAULT_RETRY_BACKOFF_INITIAL_MS;
  const retryBackoffMaxMs = dependencies.retryBackoffMaxMs ?? DEFAULT_RETRY_BACKOFF_MAX_MS;
  const wait = dependencies.wait ?? defaultWait;

  validateNonNegativeNumber(pollIntervalMs, "Job runtime poll interval");
  validatePositiveInteger(maxConcurrency, "Job runtime max concurrency");
  validatePositiveNumber(retryBackoffInitialMs, "Job runtime retry backoff initial");
  validatePositiveNumber(retryBackoffMaxMs, "Job runtime retry backoff maximum");

  if (retryBackoffMaxMs < retryBackoffInitialMs) {
    throw new RangeError(
      "Job runtime retry backoff maximum must be greater than or equal to the initial delay.",
    );
  }

  const queue = new JobQueue();
  const handlers = dependencies.handlers ?? {};
  const activeControllers = new Map<JobId, AbortController>();

  let status: JobRuntimeStatus = "STOPPED";
  let recoveredJobCount = 0;
  let completedJobCount = 0;
  let failedJobCount = 0;
  let activeJobCount = 0;
  let lastError: string | undefined;
  let lastActivityAt: string | undefined;
  let generation = 0;
  let wake: (() => void) | undefined;

  const wakeLoop = (): void => {
    const resolve = wake;
    wake = undefined;
    resolve?.();
  };

  const waitForLoop = async (milliseconds: number): Promise<void> => {
    const waiter = new Promise<void>((resolve) => {
      wake = resolve;
    });
    await Promise.race([wait(milliseconds), waiter]);
    wake = undefined;
  };

  const enqueueDueJobs = (now: string): void => {
    for (const job of dependencies.jobs.list()) {
      if (job.status === "queued" && Date.parse(job.runAt) <= Date.parse(now)) {
        queue.enqueue(job.id);
      }
    }
  };

  const retryAt = (job: Job, now: string): string => {
    const exponent = Math.max(0, job.attempt - 1);
    const delay = Math.min(retryBackoffInitialMs * 2 ** Math.min(exponent, 10), retryBackoffMaxMs);
    return new Date(Date.parse(now) + delay).toISOString();
  };

  const runOne = async (): Promise<Job | undefined> => {
    const now = dependencies.clock.now();
    enqueueDueJobs(now);

    const id = queue.dequeue();
    if (id === undefined) return undefined;

    const current = dependencies.jobs.get(id);
    if (current === undefined || current.status !== "queued") return undefined;

    if (Date.parse(current.runAt) > Date.parse(now)) return undefined;

    const started = dependencies.jobs.start(id, now);
    const controller = new AbortController();
    activeControllers.set(id, controller);
    activeJobCount += 1;
    lastActivityAt = now;

    try {
      const handler = handlers[started.kind];
      if (handler === undefined) {
        const failed = dependencies.jobs.fail({
          id,
          error: `No handler is registered for job kind: ${started.kind}.`,
          occurredAt: dependencies.clock.now(),
        });
        failedJobCount += 1;
        throw new Error(`No handler is registered for job kind: ${started.kind}.`);
      }

      const result = await handler({
        job: started,
        signal: controller.signal,
        now,
      });
      const completed = dependencies.jobs.complete({
        id,
        result,
        completedAt: dependencies.clock.now(),
      });
      completedJobCount += 1;
      lastActivityAt = completed.updatedAt;
      await dependencies.onJobCompleted?.(completed);
      return completed;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);

      const currentAfterFailure = dependencies.jobs.get(id);
      if (currentAfterFailure !== undefined && currentAfterFailure.status === "running") {
        const retryAllowed = currentAfterFailure.attempt < currentAfterFailure.maxAttempts;
        const failed = dependencies.jobs.fail({
          id,
          error: lastError,
          ...(retryAllowed
            ? { retryAt: retryAt(currentAfterFailure, dependencies.clock.now()) }
            : {}),
          occurredAt: dependencies.clock.now(),
        });

        if (failed.status === "failed") failedJobCount += 1;
      }

      dependencies.onError?.(error);
      return undefined;
    } finally {
      activeControllers.delete(id);
      activeJobCount -= 1;
      wakeLoop();
    }
  };

  const runLoop = async (expectedGeneration: number): Promise<void> => {
    while (status === "RUNNING" && generation === expectedGeneration) {
      enqueueDueJobs(dependencies.clock.now());

      while (
        status === "RUNNING" &&
        generation === expectedGeneration &&
        activeJobCount < maxConcurrency &&
        queue.size() > 0
      ) {
        void runOne();
      }

      await waitForLoop(pollIntervalMs);
    }
  };

  const start = (): void => {
    if (status === "RUNNING") return;

    const recovered = dependencies.jobs.recoverRunningJobs({
      recoveredAt: dependencies.clock.now(),
    });
    recoveredJobCount += recovered.length;
    for (const job of recovered) queue.enqueue(job.id);

    enqueueDueJobs(dependencies.clock.now());
    generation += 1;
    status = "RUNNING";
    lastActivityAt = dependencies.clock.now();
    const expectedGeneration = generation;
    void runLoop(expectedGeneration).catch((error: unknown) => {
      status = "STOPPED";
      dependencies.onError?.(error);
    });
  };

  const stop = (): void => {
    generation += 1;
    status = "STOPPED";
    for (const controller of activeControllers.values()) controller.abort();
    wakeLoop();
  };

  const runNext = async (): Promise<Job | undefined> => {
    if (status !== "RUNNING") {
      throw new Error("Job runtime is not running.");
    }
    return runOne();
  };

  const drain = async (): Promise<readonly Job[]> => {
    if (status !== "RUNNING") {
      throw new Error("Job runtime is not running.");
    }

    const completed: Job[] = [];
    while (true) {
      const job = await runOne();
      if (job === undefined) break;
      completed.push(job);
    }
    return completed;
  };

  return {
    queue,
    get status(): JobRuntimeStatus {
      return status;
    },
    get activeJobCount(): number {
      return activeJobCount;
    },
    get health(): JobRuntimeHealth {
      return {
        status,
        queuedJobCount: queue.size(),
        activeJobCount,
        recoveredJobCount,
        completedJobCount,
        failedJobCount,
        ...(lastError === undefined ? {} : { lastError }),
        ...(lastActivityAt === undefined ? {} : { lastActivityAt }),
      };
    },
    start,
    stop,
    runNext,
    drain,
    enqueue(jobId: JobId): void {
      const job = dependencies.jobs.get(jobId);
      if (job === undefined) throw new Error(`Job not found: ${jobId}.`);
      if (job.status !== "queued") {
        throw new Error(`Only queued jobs can be enqueued: ${jobId}.`);
      }
      queue.enqueue(jobId);
      wakeLoop();
    },
    cancel(jobId: JobId): Job | undefined {
      const job = dependencies.jobs.get(jobId);
      if (job === undefined) return undefined;

      const cancelled = dependencies.jobs.cancel(jobId, dependencies.clock.now());
      queue.remove(jobId);
      activeControllers.get(jobId)?.abort();
      wakeLoop();
      return cancelled;
    },
  };
}

function validatePositiveNumber(value: number, field: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${field} must be a positive finite number.`);
  }
}
