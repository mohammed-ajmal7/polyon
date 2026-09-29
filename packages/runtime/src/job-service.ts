import type { DomainEvent, Job, JobId, JobStatus } from "@polyon/contracts";
import type {
  DomainStoreTransactionContext,
  DomainUnitOfWork,
  EventStore,
  JobStore,
} from "@polyon/storage";

const DEFAULT_PRIORITY = 5;
const MAX_PRIORITY = 9;
const DEFAULT_MAX_ATTEMPTS = 3;
const MAX_MAX_ATTEMPTS = 10;
const MAX_PAYLOAD_BYTES = 256_000;

export interface EnqueueJobInput {
  readonly id?: JobId;
  readonly userId?: string;
  readonly agentRunId?: string;
  readonly type: string;
  readonly payload: unknown;
  readonly priority?: number;
  readonly maxAttempts?: number;
  readonly runAt?: string;
  readonly now?: string;
}

export interface ClaimJobInput {
  readonly workerId: string;
  readonly now: string;
}

export interface JobService {
  enqueue(input: EnqueueJobInput): Job;
  claimNext(input: ClaimJobInput): Job | undefined;
  complete(jobId: JobId, workerId: string, now: string): Job;
  fail(jobId: JobId, workerId: string, now: string, error: string, retryAt?: string): Job;
  cancel(jobId: JobId, now: string, reason?: string): Job;
  get(jobId: JobId): Job | undefined;
  list(status?: JobStatus): readonly Job[];
}

export class JobStateError extends Error {
  readonly jobId: JobId;

  constructor(jobId: JobId, message: string) {
    super(message);
    this.name = "JobStateError";
    this.jobId = jobId;
  }
}

export class DurableJobService implements JobService {
  constructor(
    private readonly jobs: JobStore,
    private readonly events: EventStore,
    private readonly unitOfWork?: DomainUnitOfWork,
  ) {}

  enqueue(input: EnqueueJobInput): Job {
    validateEnqueueInput(input);
    const now = input.now ?? new Date().toISOString();
    const runAt = input.runAt ?? now;
    const id = input.id ?? "job:" + crypto.randomUUID();

    const job: Job = {
      id,
      ...(input.userId === undefined ? {} : { userId: input.userId }),
      ...(input.agentRunId === undefined ? {} : { agentRunId: input.agentRunId }),
      type: input.type.trim(),
      payload: structuredClone(input.payload),
      status: "queued",
      priority: input.priority ?? DEFAULT_PRIORITY,
      attempt: 0,
      maxAttempts: input.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
      runAt,
      createdAt: now,
      updatedAt: now,
    };

    return this.transaction((stores) => {
      const existing = stores.jobs.get(job.id);
      if (existing !== undefined) return existing;

      stores.jobs.save(job);
      appendJobEvent(stores.events, "JOB_ENQUEUED", job, now, {
        type: job.type,
        runAt: job.runAt,
      });
      return job;
    });
  }

  claimNext(input: ClaimJobInput): Job | undefined {
    validateWorkerId(input.workerId);

    const candidate = this.jobs
      .list()
      .filter((job) => job.status === "queued" && job.runAt <= input.now)
      .sort(
        (left, right) =>
          right.priority - left.priority ||
          left.runAt.localeCompare(right.runAt) ||
          left.createdAt.localeCompare(right.createdAt) ||
          left.id.localeCompare(right.id),
      )[0];

    if (candidate === undefined) return undefined;

    return this.transaction((stores) => {
      const current = stores.jobs.get(candidate.id);
      if (
        current === undefined ||
        current.status !== "queued" ||
        current.runAt > input.now
      ) {
        return undefined;
      }

      const claimed: Job = {
        ...current,
        status: "running",
        attempt: current.attempt + 1,
        lockedBy: input.workerId,
        lockedAt: input.now,
        updatedAt: input.now,
      };
      stores.jobs.save(claimed);
      appendJobEvent(stores.events, "JOB_CLAIMED", claimed, input.now, {
        workerId: input.workerId,
        attempt: claimed.attempt,
      });
      return claimed;
    });
  }

  complete(jobId: JobId, workerId: string, now: string): Job {
    validateWorkerId(workerId);
    return this.transaction((stores) => {
      const current = requireJob(stores.jobs, jobId);
      assertRunningOwner(current, workerId);
      const completed: Job = {
        ...current,
        status: "completed",
        lockedBy: undefined,
        lockedAt: undefined,
        completedAt: now,
        updatedAt: now,
      };
      stores.jobs.save(completed);
      appendJobEvent(stores.events, "JOB_COMPLETED", completed, now, {
        workerId,
        attempt: completed.attempt,
      });
      return completed;
    });
  }

  fail(jobId: JobId, workerId: string, now: string, error: string, retryAt?: string): Job {
    validateWorkerId(workerId);
    if (error.trim() === "") throw new Error("Job failure reason must not be empty.");

    return this.transaction((stores) => {
      const current = requireJob(stores.jobs, jobId);
      assertRunningOwner(current, workerId);

      const shouldRetry = retryAt !== undefined && current.attempt < current.maxAttempts;
      const failed: Job = {
        ...current,
        status: shouldRetry ? "queued" : "failed",
        ...(shouldRetry ? { runAt: retryAt } : { failedAt: now }),
        lockedBy: undefined,
        lockedAt: undefined,
        error: error.trim().slice(0, 12_000),
        updatedAt: now,
      };
      stores.jobs.save(failed);
      appendJobEvent(stores.events, "JOB_FAILED", failed, now, {
        workerId,
        attempt: failed.attempt,
        retryScheduled: shouldRetry,
        retryAt: shouldRetry ? failed.runAt : undefined,
      });
      return failed;
    });
  }

  cancel(jobId: JobId, now: string, reason?: string): Job {
    return this.transaction((stores) => {
      const current = requireJob(stores.jobs, jobId);
      if (
        current.status === "completed" ||
        current.status === "failed" ||
        current.status === "cancelled"
      ) {
        throw new JobStateError(jobId, "Job is already terminal: " + current.status + ".");
      }

      const cancelled: Job = {
        ...current,
        status: "cancelled",
        lockedBy: undefined,
        lockedAt: undefined,
        ...(reason === undefined ? {} : { error: reason.trim().slice(0, 12_000) }),
        updatedAt: now,
      };
      stores.jobs.save(cancelled);
      appendJobEvent(stores.events, "JOB_FAILED", cancelled, now, {
        cancelled: true,
        reason: cancelled.error,
      });
      return cancelled;
    });
  }

  get(jobId: JobId): Job | undefined {
    return this.jobs.get(jobId);
  }

  list(status?: JobStatus): readonly Job[] {
    return this.jobs
      .list()
      .filter((job) => status === undefined || job.status === status)
      .sort(
        (left, right) =>
          right.createdAt.localeCompare(left.createdAt) || left.id.localeCompare(right.id),
      );
  }

  private transaction<T>(
    work: (stores: Pick<DomainStoreTransactionContext, "jobs" | "events">) => T,
  ): T {
    return this.unitOfWork === undefined
      ? work({ jobs: this.jobs, events: this.events })
      : this.unitOfWork.transaction(work);
  }
}

function validateEnqueueInput(input: EnqueueJobInput): void {
  if (input.type.trim() === "" || input.type.trim().length > 160) {
    throw new Error("Job type must be between 1 and 160 characters.");
  }

  const priority = input.priority ?? DEFAULT_PRIORITY;
  if (!Number.isInteger(priority) || priority < 0 || priority > MAX_PRIORITY) {
    throw new Error("Job priority must be an integer between 0 and 9.");
  }

  const maxAttempts = input.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  if (!Number.isInteger(maxAttempts) || maxAttempts <= 0 || maxAttempts > MAX_MAX_ATTEMPTS) {
    throw new Error("Job maxAttempts must be an integer between 1 and 10.");
  }

  let serialized: string;
  try {
    serialized = JSON.stringify(input.payload);
  } catch (error) {
    throw new Error("Job payload must be JSON serializable.", { cause: error });
  }
  if (serialized.length > MAX_PAYLOAD_BYTES) {
    throw new Error("Job payload exceeds " + MAX_PAYLOAD_BYTES + " bytes.");
  }
}

function validateWorkerId(workerId: string): void {
  if (workerId.trim() === "" || workerId.trim().length > 160) {
    throw new Error("Worker id must be between 1 and 160 characters.");
  }
}

function requireJob(jobs: JobStore, jobId: JobId): Job {
  const job = jobs.get(jobId);
  if (job === undefined) throw new JobStateError(jobId, "Job not found.");
  return job;
}

function assertRunningOwner(job: Job, workerId: string): void {
  if (job.status !== "running") {
    throw new JobStateError(job.id, "Job is not running: " + job.status + ".");
  }
  if (job.lockedBy !== workerId) {
    throw new JobStateError(job.id, "Job is owned by another worker.");
  }
}

function appendJobEvent(
  events: EventStore,
  kind: DomainEvent["kind"],
  job: Job,
  occurredAt: string,
  data: Record<string, unknown>,
): void {
  events.append({
    id: kind + ":" + job.id + ":" + job.attempt + ":" + occurredAt,
    kind,
    actorId: job.userId,
    agentRunId: job.agentRunId,
    occurredAt,
    data: {
      jobId: job.id,
      status: job.status,
      ...data,
    },
  });
}
