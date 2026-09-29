import type { Job, Schedule } from "@polyon/contracts";
import type {
  DomainStoreTransactionContext,
  DomainUnitOfWork,
  EventStore,
  ScheduleStore,
} from "@polyon/storage";

export interface ScheduleRunner {
  runDue(now: string, limit?: number): readonly Job[];
}

export interface ScheduleJobEnqueuer {
  enqueueInTransaction(
    stores: Pick<DomainStoreTransactionContext, "jobs" | "events">,
    input: EnqueueJobInput,
  ): Job;
}

export class DurableScheduleRunner implements ScheduleRunner {
  constructor(
    private readonly schedules: ScheduleStore,
    private readonly jobs: ScheduleJobEnqueuer,
    private readonly events: EventStore,
    private readonly unitOfWork?: DomainUnitOfWork,
  ) {}

  runDue(now: string, limit = 50): readonly Job[] {
    if (!Number.isInteger(limit) || limit <= 0 || limit > 500) {
      throw new RangeError("Schedule limit must be an integer between 1 and 500.");
    }

    const due = this.schedules
      .list()
      .filter((schedule) => schedule.enabled && schedule.nextRunAt <= now)
      .sort(
        (left, right) =>
          left.nextRunAt.localeCompare(right.nextRunAt) || left.id.localeCompare(right.id),
      )
      .slice(0, limit);

    const created: Job[] = [];
    for (const schedule of due) {
      const job = this.runOne(schedule, now);
      if (job !== undefined) created.push(job);
    }
    return created;
  }

  private runOne(schedule: Schedule, now: string): Job | undefined {
    return this.transaction((stores) => {
      const current = stores.schedules.get(schedule.id);
      if (current === undefined || !current.enabled || current.nextRunAt > now) return undefined;

      const jobId = "schedule:" + current.id + ":" + current.nextRunAt;
      const existing = stores.jobs.get(jobId);

      const job =
        existing ??
        this.jobs.enqueueInTransaction(stores, {
          id: jobId,
          userId: current.userId,
          type: current.jobType,
          payload: current.payload,
          runAt: now,
          now,
        });

      const nextRunAt = advanceInterval(current.nextRunAt, current.intervalSeconds);
      stores.schedules.save({
        ...current,
        nextRunAt,
        lastJobId: job.id,
        updatedAt: now,
      });

      stores.events.append({
        id: "SCHEDULE_TRIGGERED:" + current.id + ":" + current.nextRunAt,
        kind: "SCHEDULE_TRIGGERED",
        actorId: current.userId,
        occurredAt: now,
        data: {
          scheduleId: current.id,
          jobId: job.id,
          nextRunAt,
        },
      });

      return job;
    });
  }

  private transaction<T>(
    work: (
      stores: Pick<DomainStoreTransactionContext, "jobs" | "schedules" | "events">,
    ) => T,
  ): T {
    if (this.unitOfWork === undefined) {
      throw new Error("DurableScheduleRunner requires a shared domain unit of work.");
    }
    return this.unitOfWork.transaction(work);
  }
}

function advanceInterval(nextRunAt: string, intervalSeconds: number): string {
  if (
    !Number.isFinite(intervalSeconds) ||
    !Number.isInteger(intervalSeconds) ||
    intervalSeconds <= 0
  ) {
    throw new RangeError("Schedule intervalSeconds must be a positive integer.");
  }

  const current = Date.parse(nextRunAt);
  if (!Number.isFinite(current)) {
    throw new Error("Schedule nextRunAt must be a valid ISO timestamp.");
  }

  return new Date(current + intervalSeconds * 1000).toISOString();
}
