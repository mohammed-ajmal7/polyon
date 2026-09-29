import type { Job } from "@polyon/contracts";

import type { JobWorker } from "./job-worker";
import type { ScheduleRunner } from "./schedule-runner";

export interface JobRuntimeOptions {
  readonly intervalMs?: number;
  readonly jobsPerTick?: number;
  readonly workerId?: string;
  readonly onError?: (error: unknown) => void;
}

export interface JobRuntimeHealth {
  readonly running: boolean;
  readonly tickActive: boolean;
  readonly lastTickAt?: string;
  readonly lastSuccessAt?: string;
  readonly lastErrorAt?: string;
  readonly lastError?: string;
}

export interface JobRuntime {
  readonly health: JobRuntimeHealth;
  start(): void;
  stop(): void;
  tick(): Promise<readonly Job[]>;
}

const DEFAULT_INTERVAL_MS = 5_000;
const DEFAULT_JOBS_PER_TICK = 8;

export class DurableJobRuntime implements JobRuntime {
  private runningState = false;
  private tickActiveState = false;
  private timer: ReturnType<typeof setInterval> | undefined;
  private lastTickAtState: string | undefined;
  private lastSuccessAtState: string | undefined;
  private lastErrorAtState: string | undefined;
  private lastErrorState: string | undefined;

  private readonly intervalMs: number;
  private readonly jobsPerTick: number;
  private readonly workerId: string;

  constructor(
    private readonly scheduleRunner: ScheduleRunner,
    private readonly worker: JobWorker,
    private readonly options: JobRuntimeOptions = {},
  ) {
    this.intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
    this.jobsPerTick = options.jobsPerTick ?? DEFAULT_JOBS_PER_TICK;
    this.workerId = options.workerId ?? "polyon-worker";
    if (!Number.isInteger(this.intervalMs) || this.intervalMs < 1_000 || this.intervalMs > 3_600_000) {
      throw new RangeError("Job runtime interval must be between 1000 and 3600000 ms.");
    }
    if (!Number.isInteger(this.jobsPerTick) || this.jobsPerTick <= 0 || this.jobsPerTick > 100) {
      throw new RangeError("Job runtime jobsPerTick must be between 1 and 100.");
    }
  }

  get health(): JobRuntimeHealth {
    return {
      running: this.runningState,
      tickActive: this.tickActiveState,
      ...(this.lastTickAtState === undefined ? {} : { lastTickAt: this.lastTickAtState }),
      ...(this.lastSuccessAtState === undefined ? {} : { lastSuccessAt: this.lastSuccessAtState }),
      ...(this.lastErrorAtState === undefined ? {} : { lastErrorAt: this.lastErrorAtState }),
      ...(this.lastErrorState === undefined ? {} : { lastError: this.lastErrorState }),
    };
  }

  start(): void {
    if (this.runningState) return;
    this.runningState = true;
    this.timer = globalThis.setInterval(() => {
      void this.runScheduledTick();
    }, this.intervalMs);
    void this.runScheduledTick();
  }

  stop(): void {
    this.runningState = false;
    if (this.timer !== undefined) {
      globalThis.clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  async tick(): Promise<readonly Job[]> {
    if (this.tickActiveState) return [];
    this.tickActiveState = true;
    this.lastTickAtState = new Date().toISOString();

    try {
      const now = new Date().toISOString();
      this.scheduleRunner.runDue(now);
      const jobs = await this.worker.drain(this.workerId, undefined);
      this.lastSuccessAtState = new Date().toISOString();
      this.lastErrorState = undefined;
      return jobs;
    } catch (error) {
      this.lastErrorAtState = new Date().toISOString();
      this.lastErrorState = error instanceof Error ? error.message : String(error);
      this.options.onError?.(error);
      throw error;
    } finally {
      this.tickActiveState = false;
    }
  }

  private async runScheduledTick(): Promise<void> {
    if (!this.runningState || this.tickActiveState) return;
    try {
      await this.tickWithBound();
    } catch {
      // tick() already records and reports the error.
    }
  }

  private async tickWithBound(): Promise<readonly Job[]> {
    this.tickActiveState = true;
    this.lastTickAtState = new Date().toISOString();

    try {
      const now = new Date().toISOString();
      this.scheduleRunner.runDue(now);
      const jobs: Job[] = [];
      for (let index = 0; index < this.jobsPerTick; index += 1) {
        const result = await this.worker.runNext(this.workerId);
        if (result === undefined) break;
        jobs.push(result);
      }
      this.lastSuccessAtState = new Date().toISOString();
      this.lastErrorState = undefined;
      return jobs;
    } catch (error) {
      this.lastErrorAtState = new Date().toISOString();
      this.lastErrorState = error instanceof Error ? error.message : String(error);
      this.options.onError?.(error);
      throw error;
    } finally {
      this.tickActiveState = false;
    }
  }
}
