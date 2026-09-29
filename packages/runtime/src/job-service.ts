import type { DomainEvent, Job, JobId, JobKind, JobStatus } from "@polyon/contracts";
import type {
  DomainUnitOfWork,
  EventStore,
  JobStore,
} from "@polyon/storage";

const MAX_ID_LENGTH = 200;
const MAX_USER_ID_LENGTH = 200;
const MAX_ERROR_LENGTH = 8_000;
const MAX_PAYLOAD_CHARACTERS = 64_000;
const MAX_ATTEMPTS = 10;

export interface CreateJobInput {
  readonly id: JobId;
  readonly userId: string;
  readonly kind: JobKind;
  readonly payload: unknown;
  readonly runAt: string;
  readonly maxAttempts?: number;
  readonly createdAt: string;
}

export interface CompleteJobInput {
  readonly id: JobId;
  readonly result?: unknown;
  readonly completedAt: string;
}

export interface FailJobInput {
  readonly id: JobId;
  readonly error: string;
  readonly retryAt?: string;
  readonly occurredAt: string;
}

export interface RecoverJobsInput {
  readonly recoveredAt: string;
}

export interface JobServiceDependencies {
  readonly jobs: JobStore;
  readonly events: EventStore;
  readonly unitOfWork?: DomainUnitOfWork;
}

export class JobService {
  constructor(private readonly dependencies: JobServiceDependencies) {}

  create(input: CreateJobInput): Job {
    validateCreate(input);

    const existing = this.dependencies.jobs.get(input.id);
    if (existing !== undefined) {
      throw new Error(`Job already exists: ${input.id}.`);
    }

    const job: Job = {
      id: input.id.trim(),
      userId: input.userId.trim(),
      kind: input.kind,
      status: "queued",
      payload: structuredClone(input.payload),
      attempt: 0,
      maxAttempts: input.maxAttempts ?? 3,
      runAt: input.runAt,
      createdAt: input.createdAt,
      updatedAt: input.createdAt,
    };

    return this.withStores((stores) => {
      stores.jobs.save(job);
      appendEvent(stores.events, {
        id: `JOB_CREATED:${job.id}`,
        kind: "JOB_CREATED",
        actorId: job.userId,
        occurredAt: job.createdAt,
        data: {
          jobId: job.id,
          jobKind: job.kind,
          maxAttempts: job.maxAttempts,
          runAt: job.runAt,
        },
      });
      return job;
    });
  }

  start(id: JobId, startedAt: string): Job {
    return this.withStores((stores) => {
      const current = requireJob(stores.jobs, id);
      if (current.status !== "queued") {
        throw invalidTransition(current, "running");
      }
      if (Date.parse(current.runAt) > Date.parse(startedAt)) {
        throw new Error(`Job is not due yet: ${id}.`);
      }

      const next: Job = {
        ...current,
        status: "running",
        attempt: current.attempt + 1,
        startedAt,
        updatedAt: startedAt,
        error: undefined,
        result: undefined,
        completedAt: undefined,
      };
      stores.jobs.save(next);
      appendStatusEvent(stores.events, current, next, startedAt);
      return next;
    });
  }

  complete(input: CompleteJobInput): Job {
    validateTimestamp(input.completedAt, "completedAt");
    if (input.result !== undefined) validateJsonPayload(input.result);

    return this.withStores((stores) => {
      const current = requireJob(stores.jobs, input.id);
      if (current.status !== "running") {
        throw invalidTransition(current, "completed");
      }

      const next: Job = {
        ...current,
        status: "completed",
        ...(input.result === undefined ? {} : { result: structuredClone(input.result) }),
        completedAt: input.completedAt,
        updatedAt: input.completedAt,
        error: undefined,
      };
      stores.jobs.save(next);
      appendStatusEvent(stores.events, current, next, input.completedAt);
      return next;
    });
  }

  fail(input: FailJobInput): Job {
    validateTimestamp(input.occurredAt, "occurredAt");
    const error = input.error.trim();
    if (error.length === 0 || error.length > MAX_ERROR_LENGTH) {
      throw new RangeError(
        `Job error must contain 1-${MAX_ERROR_LENGTH} characters.`,
      );
    }

    if (input.retryAt !== undefined) {
      validateTimestamp(input.retryAt, "retryAt");
    }

    return this.withStores((stores) => {
      const current = requireJob(stores.jobs, input.id);
      if (current.status !== "running") {
        throw invalidTransition(current, "failed");
      }

      const shouldRetry =
        input.retryAt !== undefined && current.attempt < current.maxAttempts;
      const next: Job = shouldRetry
        ? {
            ...current,
            status: "queued",
            runAt: input.retryAt!,
            updatedAt: input.occurredAt,
            error,
            completedAt: undefined,
          }
        : {
            ...current,
            status: "failed",
            updatedAt: input.occurredAt,
            completedAt: input.occurredAt,
            error,
          };

      stores.jobs.save(next);
      appendStatusEvent(stores.events, current, next, input.occurredAt);
      return next;
    });
  }

  cancel(id: JobId, cancelledAt: string): Job {
    validateTimestamp(cancelledAt, "cancelledAt");

    return this.withStores((stores) => {
      const current = requireJob(stores.jobs, id);
      if (current.status !== "queued" && current.status !== "running") {
        throw invalidTransition(current, "cancelled");
      }

      const next: Job = {
        ...current,
        status: "cancelled",
        completedAt: cancelledAt,
        updatedAt: cancelledAt,
      };
      stores.jobs.save(next);
      appendStatusEvent(stores.events, current, next, cancelledAt);
      return next;
    });
  }

  recoverRunningJobs(input: RecoverJobsInput): readonly Job[] {
    validateTimestamp(input.recoveredAt, "recoveredAt");

    return this.withStores((stores) => {
      const recovered: Job[] = [];

      for (const current of stores.jobs.list()) {
        if (current.status !== "running") continue;

        const next: Job = {
          ...current,
          status: "queued",
          runAt: input.recoveredAt,
          updatedAt: input.recoveredAt,
        };
        stores.jobs.save(next);
        appendStatusEvent(stores.events, current, next, input.recoveredAt);
        appendEvent(stores.events, {
          id: `JOB_RECOVERED:${current.id}:${input.recoveredAt}`,
          kind: "JOB_RECOVERED",
          actorId: current.userId,
          occurredAt: input.recoveredAt,
          data: {
            jobId: current.id,
            attempt: current.attempt,
          },
        });
        recovered.push(next);
      }

      return recovered;
    });
  }

  get(id: JobId): Job | undefined {
    return this.dependencies.jobs.get(id);
  }

  listByUser(userId: string): readonly Job[] {
    const normalized = userId.trim();
    return this.dependencies.jobs
      .list()
      .filter((job) => job.userId === normalized)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  list(): readonly Job[] {
    return this.dependencies.jobs.list();
  }

  private withStores<T>(work: (stores: Pick<JobServiceDependencies, "jobs" | "events">) => T): T {
    if (this.dependencies.unitOfWork === undefined) return work(this.dependencies);
    return this.dependencies.unitOfWork.transaction(work);
  }
}

function validateCreate(input: CreateJobInput): void {
  assertText(input.id, "id", MAX_ID_LENGTH);
  assertText(input.userId, "userId", MAX_USER_ID_LENGTH);
  validateTimestamp(input.runAt, "runAt");
  validateTimestamp(input.createdAt, "createdAt");
  validateJsonPayload(input.payload);

  const maxAttempts = input.maxAttempts ?? 3;
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > MAX_ATTEMPTS) {
    throw new RangeError(`maxAttempts must be an integer between 1 and ${MAX_ATTEMPTS}.`);
  }
}

function assertText(value: string, field: string, maxLength: number): void {
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > maxLength) {
    throw new RangeError(`${field} must contain 1-${maxLength} characters.`);
  }
}

function validateTimestamp(value: string, field: string): void {
  if (Number.isNaN(Date.parse(value))) {
    throw new RangeError(`${field} must be a valid timestamp.`);
  }
}

function validateJsonPayload(payload: unknown): void {
  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(payload);
  } catch (error) {
    throw new RangeError("Job payload must be JSON-serializable.", { cause: error });
  }

  if (serialized === undefined) {
    throw new RangeError("Job payload must serialize to JSON.");
  }

  if (serialized.length > MAX_PAYLOAD_CHARACTERS) {
    throw new RangeError(
      `Job payload exceeds ${MAX_PAYLOAD_CHARACTERS} serialized characters.`,
    );
  }
}

function requireJob(store: JobStore, id: JobId): Job {
  const job = store.get(id);
  if (job === undefined) throw new Error(`Job not found: ${id}.`);
  return job;
}

function invalidTransition(current: Job, nextStatus: JobStatus): Error {
  return new Error(`Invalid job transition: ${current.status} -> ${nextStatus}.`);
}

function appendStatusEvent(events: EventStore, previous: Job, next: Job, occurredAt: string): void {
  appendEvent(events, {
    id: `JOB_STATUS_CHANGED:${next.id}:${previous.status}:${next.status}:${occurredAt}`,
    kind: "JOB_STATUS_CHANGED",
    actorId: next.userId,
    occurredAt,
    data: {
      jobId: next.id,
      from: previous.status,
      to: next.status,
      attempt: next.attempt,
      runAt: next.runAt,
    },
  });
}

function appendEvent(events: EventStore, event: DomainEvent): void {
  if (events.get(event.id) !== undefined) return;
  events.append(event);
}
