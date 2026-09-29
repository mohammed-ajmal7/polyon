import type { Job, MemoryScope } from "@polyon/contracts";
import type { SemanticMemoryService } from "./semantic-memory-service";

export interface SemanticMemoryIndexJobBridge {
  create(input: {
    readonly id: string;
    readonly userId: string;
    readonly kind: "scheduled";
    readonly payload: unknown;
    readonly runAt: string;
    readonly maxAttempts?: number;
    readonly createdAt: string;
  }): Job;
  get(id: string): Job | undefined;
  list(): readonly Job[];
}

export interface SemanticMemoryIndexJobContext {
  readonly job: Job;
  readonly signal: AbortSignal;
  readonly now: string;
}

export interface SemanticMemoryIndexerOptions {
  readonly intervalMs?: number;
  readonly batchSize?: number;
  readonly maxEntries?: number;
  readonly allowedScopes?: readonly MemoryScope[];
  readonly onError?: (error: unknown) => void;
  readonly jobBridge?: SemanticMemoryIndexJobBridge;
  readonly jobUserId?: string;
  readonly jobIdPrefix?: string;
  readonly jobMaxAttempts?: number;
}

export interface SemanticMemoryIndexerHealth {
  readonly running: boolean;
  readonly cycleActive: boolean;
  readonly indexedCount: number;
  readonly scheduledJobId?: string;
  readonly lastCycleAt?: string;
  readonly lastSuccessAt?: string;
  readonly lastErrorAt?: string;
  readonly lastError?: string;
  readonly consecutiveErrorCount: number;
}

export interface SemanticMemoryIndexer {
  start(): void;
  stop(): void;
  runOnce(): Promise<{
    readonly indexed: number;
    readonly stale: number;
    readonly skipped: number;
  }>;
  isDurableJob(job: Job): boolean;
  runDurableJob(context: SemanticMemoryIndexJobContext): Promise<{
    readonly indexed: number;
    readonly stale: number;
    readonly skipped: number;
  }>;
  readonly health: SemanticMemoryIndexerHealth;
}

const DEFAULT_INTERVAL_MS = 30_000;
const DEFAULT_BATCH_SIZE = 16;
const DEFAULT_MAX_ENTRIES = 100;
const MIN_INTERVAL_MS = 1_000;
const MAX_INTERVAL_MS = 3_600_000;
const DEFAULT_JOB_USER_ID = "system";
const DEFAULT_JOB_ID_PREFIX = "semantic-memory-index";
const DEFAULT_JOB_MAX_ATTEMPTS = 3;
const DURABLE_JOB_MARKER = "semantic-memory-index";

export function createSemanticMemoryIndexer(
  service: SemanticMemoryService,
  modelId: string,
  options: SemanticMemoryIndexerOptions = {},
): SemanticMemoryIndexer {
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
  const maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
  const jobUserId = options.jobUserId?.trim() || DEFAULT_JOB_USER_ID;
  const jobIdPrefix = options.jobIdPrefix?.trim() || DEFAULT_JOB_ID_PREFIX;
  const jobMaxAttempts = options.jobMaxAttempts ?? DEFAULT_JOB_MAX_ATTEMPTS;

  if (
    !Number.isInteger(intervalMs) ||
    intervalMs < MIN_INTERVAL_MS ||
    intervalMs > MAX_INTERVAL_MS
  ) {
    throw new RangeError(
      `Semantic memory indexing interval must be an integer between ${MIN_INTERVAL_MS} and ${MAX_INTERVAL_MS} milliseconds.`,
    );
  }

  if (modelId.trim() === "") {
    throw new RangeError("Semantic memory indexing model ID must not be empty.");
  }

  if (jobUserId.length > 200) {
    throw new RangeError("Semantic memory indexing job user ID is too long.");
  }

  if (jobIdPrefix.length === 0 || jobIdPrefix.length > 120) {
    throw new RangeError("Semantic memory indexing job ID prefix must contain 1-120 characters.");
  }

  if (!Number.isInteger(jobMaxAttempts) || jobMaxAttempts < 1 || jobMaxAttempts > 10) {
    throw new RangeError("Semantic memory indexing job max attempts must be an integer between 1 and 10.");
  }

  let running = false;
  let cycleActive = false;
  let generation = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let controller: AbortController | undefined;
  let indexedCount = 0;
  let scheduledJobId: string | undefined;
  let lastCycleAt: string | undefined;
  let lastSuccessAt: string | undefined;
  let lastErrorAt: string | undefined;
  let lastError: string | undefined;
  let consecutiveErrorCount = 0;

  const durable = options.jobBridge !== undefined;

  const makePayload = (cycle: number): Record<string, unknown> => ({
    scheduler: DURABLE_JOB_MARKER,
    cycle,
    modelId,
    batchSize,
    maxEntries,
    allowedScopes: options.allowedScopes ?? [],
  });

  const readCycle = (job: Job): number | undefined => {
    if (job.kind !== "scheduled" || !isRecord(job.payload)) return undefined;
    if (job.payload.scheduler !== DURABLE_JOB_MARKER || job.payload.modelId !== modelId) {
      return undefined;
    }

    const cycle = job.payload.cycle;
    return typeof cycle === "number" && Number.isInteger(cycle) && cycle >= 1 ? cycle : undefined;
  };

  const jobIdForCycle = (cycle: number): string =>
    `${jobIdPrefix}:${cycle}`;

  const scheduleNextDurableJob = (cycle: number, runAt: string, createdAt: string): Job => {
    if (options.jobBridge === undefined) {
      throw new Error("Semantic memory durable job bridge is not configured.");
    }

    const id = jobIdForCycle(cycle);
    const existing = options.jobBridge.get(id);
    if (existing !== undefined) {
      scheduledJobId = existing.id;
      return existing;
    }

    const job = options.jobBridge.create({
      id,
      userId: jobUserId,
      kind: "scheduled",
      payload: makePayload(cycle),
      runAt,
      maxAttempts: jobMaxAttempts,
      createdAt,
    });
    scheduledJobId = job.id;
    return job;
  };

  const ensureDurableJobScheduled = (now: string): Job | undefined => {
    if (!durable || options.jobBridge === undefined) return undefined;

    const jobs = options.jobBridge
      .list()
      .filter(isMatchingDurableJob)
      .sort((a, b) => {
        const byCycle = (readCycle(b) ?? 0) - (readCycle(a) ?? 0);
        return byCycle !== 0 ? byCycle : b.updatedAt.localeCompare(a.updatedAt);
      });

    const active = jobs.find((job) => job.status === "queued" || job.status === "running");
    if (active !== undefined) {
      scheduledJobId = active.id;
      return active;
    }

    const latest = jobs[0];
    const cycle = (readCycle(latest) ?? 0) + 1;

    const runAt =
      latest?.status === "completed" && latest.completedAt !== undefined
        ? new Date(Date.parse(latest.completedAt) + intervalMs).toISOString()
        : now;

    return scheduleNextDurableJob(cycle, runAt, now);
  };

  const executeCycle = async (
    signal?: AbortSignal,
  ): Promise<{ readonly indexed: number; readonly stale: number; readonly skipped: number }> => {
    cycleActive = true;
    lastCycleAt = new Date().toISOString();

    try {
      const result = await service.reindex(modelId, {
        now: new Date().toISOString(),
        batchSize,
        maxEntries,
        allowedScopes: options.allowedScopes,
        signal,
      });
      indexedCount += result.indexed;
      consecutiveErrorCount = 0;
      lastError = undefined;
      lastSuccessAt = new Date().toISOString();
      return result;
    } catch (error) {
      consecutiveErrorCount += 1;
      lastErrorAt = new Date().toISOString();
      lastError = error instanceof Error ? error.message : String(error);
      throw error;
    } finally {
      cycleActive = false;
    }
  };

  const schedule = (currentGeneration: number): void => {
    if (!running || generation !== currentGeneration || durable) return;
    timer = globalThis.setTimeout(() => {
      void cycle(currentGeneration);
    }, intervalMs);
  };

  const cycle = async (currentGeneration: number): Promise<void> => {
    if (!running || generation !== currentGeneration || cycleActive) return;

    controller = new AbortController();
    try {
      await executeCycle(controller.signal);
    } catch (error) {
      options.onError?.(error);
    } finally {
      controller = undefined;
      if (running && generation === currentGeneration) schedule(currentGeneration);
    }
  };

  const runDurableJob = async (
    context: SemanticMemoryIndexJobContext,
  ): Promise<{ readonly indexed: number; readonly stale: number; readonly skipped: number }> => {
    if (!isMatchingDurableJob(context.job)) {
      throw new Error(`Job is not a semantic memory index job: ${context.job.id}.`);
    }

    const result = await executeCycle(context.signal);
    const cycle = readCycle(context.job);
    if (cycle === undefined) {
      throw new Error(`Semantic memory index job cycle is invalid: ${context.job.id}.`);
    }

    if (options.jobBridge !== undefined) {
      const completedAt = new Date().toISOString();
      const nextRunAt = new Date(
        Date.parse(completedAt) + intervalMs,
      ).toISOString();
      scheduleNextDurableJob(cycle + 1, nextRunAt, completedAt);
    }

    return result;
  };

  const isMatchingDurableJob = (job: Job): boolean =>
    job.kind === "scheduled" &&
    readCycle(job) !== undefined &&
    job.userId === jobUserId;

  return {
    start(): void {
      if (running) return;
      running = true;
      generation += 1;

      if (durable) {
        ensureDurableJobScheduled(new Date().toISOString());
        return;
      }

      const currentGeneration = generation;
      void cycle(currentGeneration);
    },

    stop(): void {
      running = false;
      generation += 1;
      if (timer !== undefined) {
        globalThis.clearTimeout(timer);
        timer = undefined;
      }
      controller?.abort();
      controller = undefined;
    },

    runOnce(): Promise<{
      readonly indexed: number;
      readonly stale: number;
      readonly skipped: number;
    }> {
      if (cycleActive) {
        return Promise.reject(new Error("Semantic memory indexing cycle is already active."));
      }
      return executeCycle();
    },

    isDurableJob(job: Job): boolean {
      return isMatchingDurableJob(job);
    },

    runDurableJob,

    get health(): SemanticMemoryIndexerHealth {
      return {
        running,
        cycleActive,
        indexedCount,
        ...(scheduledJobId === undefined ? {} : { scheduledJobId }),
        ...(lastCycleAt === undefined ? {} : { lastCycleAt }),
        ...(lastSuccessAt === undefined ? {} : { lastSuccessAt }),
        ...(lastErrorAt === undefined ? {} : { lastErrorAt }),
        ...(lastError === undefined ? {} : { lastError }),
        consecutiveErrorCount,
      };
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
