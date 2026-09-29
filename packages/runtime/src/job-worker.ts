import type { Job } from "@polyon/contracts";

import type { JobService } from "./job-service";

export interface JobHandlerContext {
  readonly job: Job;
  readonly signal: AbortSignal;
  readonly now: () => string;
}

export type JobHandler = (context: JobHandlerContext) => Promise<void>;

export interface JobWorkerOptions {
  readonly maxJobsPerDrain?: number;
  readonly retryDelaySeconds?: number;
}

export class JobHandlerRegistry {
  private readonly handlers = new Map<string, JobHandler>();

  register(type: string, handler: JobHandler): void {
    const normalized = type.trim();
    if (normalized === "" || normalized.length > 160) {
      throw new Error("Job handler type must be between 1 and 160 characters.");
    }
    if (this.handlers.has(normalized)) {
      throw new Error("Job handler already registered: " + normalized + ".");
    }
    this.handlers.set(normalized, handler);
  }

  get(type: string): JobHandler | undefined {
    return this.handlers.get(type);
  }
}

export interface JobWorker {
  runNext(workerId: string, signal?: AbortSignal): Promise<Job | undefined>;
  drain(workerId: string, signal?: AbortSignal): Promise<readonly Job[]>;
}

export class DurableJobWorker implements JobWorker {
  constructor(
    private readonly jobs: JobService,
    private readonly handlers: JobHandlerRegistry,
    private readonly options: JobWorkerOptions = {},
  ) {}

  async runNext(
    workerId: string,
    signal = new AbortController().signal,
  ): Promise<Job | undefined> {
    const job = this.jobs.claimNext({
      workerId,
      now: new Date().toISOString(),
    });
    if (job === undefined) return undefined;

    const handler = this.handlers.get(job.type);
    if (handler === undefined) {
      return this.jobs.fail(
        job.id,
        workerId,
        new Date().toISOString(),
        "No handler registered for job type: " + job.type + ".",
      );
    }

    try {
      await handler({
        job,
        signal,
        now: () => new Date().toISOString(),
      });
      return this.jobs.complete(job.id, workerId, new Date().toISOString());
    } catch (error) {
      const retryDelaySeconds = Math.max(1, this.options.retryDelaySeconds ?? 30);
      const retryAt = new Date(Date.now() + retryDelaySeconds * 1000).toISOString();
      return this.jobs.fail(
        job.id,
        workerId,
        new Date().toISOString(),
        error instanceof Error ? error.message : "Job handler failed.",
        retryAt,
      );
    }
  }

  async drain(
    workerId: string,
    signal = new AbortController().signal,
  ): Promise<readonly Job[]> {
    const maxJobs = this.options.maxJobsPerDrain ?? 100;
    if (!Number.isInteger(maxJobs) || maxJobs <= 0 || maxJobs > 1_000) {
      throw new RangeError("maxJobsPerDrain must be an integer between 1 and 1000.");
    }

    const completed: Job[] = [];
    for (let count = 0; count < maxJobs; count += 1) {
      if (signal.aborted) break;
      const job = await this.runNext(workerId, signal);
      if (job === undefined) break;
      completed.push(job);
    }
    return completed;
  }
}
