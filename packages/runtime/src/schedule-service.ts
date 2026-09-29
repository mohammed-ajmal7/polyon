import type { DomainEvent, Schedule, ScheduleId } from "@polyon/contracts";
import type {
  DomainStoreTransactionContext,
  DomainUnitOfWork,
  EventStore,
  ScheduleStore,
} from "@polyon/storage";

export interface CreateScheduleInput {
  readonly id?: ScheduleId;
  readonly userId: string;
  readonly jobType: string;
  readonly payload: unknown;
  readonly intervalSeconds: number;
  readonly nextRunAt: string;
  readonly now?: string;
}

export interface UpdateScheduleInput {
  readonly jobType?: string;
  readonly payload?: unknown;
  readonly intervalSeconds?: number;
  readonly nextRunAt?: string;
  readonly enabled?: boolean;
  readonly now: string;
}

export class ScheduleStateError extends Error {
  readonly scheduleId: ScheduleId;

  constructor(scheduleId: ScheduleId, message: string) {
    super(message);
    this.name = "ScheduleStateError";
    this.scheduleId = scheduleId;
  }
}

export class ScheduleService {
  constructor(
    private readonly schedules: ScheduleStore,
    private readonly events: EventStore,
    private readonly unitOfWork: DomainUnitOfWork,
  ) {}

  create(input: CreateScheduleInput): Schedule {
    validateCreate(input);
    const now = input.now ?? new Date().toISOString();
    const schedule: Schedule = {
      id: input.id ?? "schedule:" + crypto.randomUUID(),
      userId: input.userId,
      jobType: input.jobType.trim(),
      payload: structuredClone(input.payload),
      intervalSeconds: input.intervalSeconds,
      nextRunAt: input.nextRunAt,
      enabled: true,
      createdAt: now,
      updatedAt: now,
    };

    return this.unitOfWork.transaction((stores) => {
      if (stores.schedules.get(schedule.id) !== undefined) {
        throw new ScheduleStateError(schedule.id, "Schedule already exists.");
      }
      stores.schedules.save(schedule);
      stores.events.append(scheduleEvent("OTHER", schedule, now, "created"));
      return schedule;
    });
  }

  update(scheduleId: ScheduleId, input: UpdateScheduleInput): Schedule {
    validateUpdate(input);
    return this.unitOfWork.transaction((stores) => {
      const current = stores.schedules.get(scheduleId);
      if (current === undefined) {
        throw new ScheduleStateError(scheduleId, "Schedule not found.");
      }

      const next: Schedule = {
        ...current,
        ...(input.jobType === undefined ? {} : { jobType: input.jobType.trim() }),
        ...(input.payload === undefined ? {} : { payload: structuredClone(input.payload) }),
        ...(input.intervalSeconds === undefined
          ? {}
          : { intervalSeconds: input.intervalSeconds }),
        ...(input.nextRunAt === undefined ? {} : { nextRunAt: input.nextRunAt }),
        ...(input.enabled === undefined ? {} : { enabled: input.enabled }),
        updatedAt: input.now,
      };

      stores.schedules.save(next);
      stores.events.append(scheduleEvent("OTHER", next, input.now, "updated"));
      return next;
    });
  }

  setEnabled(scheduleId: ScheduleId, enabled: boolean, now: string): Schedule {
    return this.update(scheduleId, { enabled, now });
  }

  get(scheduleId: ScheduleId): Schedule | undefined {
    return this.schedules.get(scheduleId);
  }

  listByUser(userId: string): readonly Schedule[] {
    return this.schedules
      .list()
      .filter((schedule) => schedule.userId === userId)
      .sort(
        (left, right) =>
          left.nextRunAt.localeCompare(right.nextRunAt) || left.id.localeCompare(right.id),
      );
  }
}

function validateCreate(input: CreateScheduleInput): void {
  validateCommon(input.jobType, input.payload, input.intervalSeconds, input.nextRunAt);
  if (input.userId.trim() === "") throw new Error("Schedule userId must not be empty.");
}

function validateUpdate(input: UpdateScheduleInput): void {
  if (
    input.jobType === undefined &&
    input.payload === undefined &&
    input.intervalSeconds === undefined &&
    input.nextRunAt === undefined &&
    input.enabled === undefined
  ) {
    throw new Error("Schedule update must change at least one field.");
  }
  if (input.jobType !== undefined && input.jobType.trim() === "") {
    throw new Error("Schedule jobType must not be empty.");
  }
  if (input.intervalSeconds !== undefined) {
    validateInterval(input.intervalSeconds);
  }
  if (input.nextRunAt !== undefined && !Number.isFinite(Date.parse(input.nextRunAt))) {
    throw new Error("Schedule nextRunAt must be a valid ISO timestamp.");
  }
}

function validateCommon(
  jobType: string,
  payload: unknown,
  intervalSeconds: number,
  nextRunAt: string,
): void {
  if (jobType.trim() === "" || jobType.trim().length > 160) {
    throw new Error("Schedule jobType must be between 1 and 160 characters.");
  }
  validateInterval(intervalSeconds);
  if (!Number.isFinite(Date.parse(nextRunAt))) {
    throw new Error("Schedule nextRunAt must be a valid ISO timestamp.");
  }

  const serialized = JSON.stringify(payload);
  if (serialized.length > 256_000) {
    throw new Error("Schedule payload exceeds 256000 bytes.");
  }
}

function validateInterval(intervalSeconds: number): void {
  if (
    !Number.isInteger(intervalSeconds) ||
    intervalSeconds <= 0 ||
    intervalSeconds > 31_536_000
  ) {
    throw new RangeError("Schedule intervalSeconds must be between 1 and 31536000.");
  }
}

function scheduleEvent(
  kind: DomainEvent["kind"],
  schedule: Schedule,
  occurredAt: string,
  action: "created" | "updated",
): DomainEvent {
  return {
    id: "SCHEDULE_" + action.toUpperCase() + ":" + schedule.id + ":" + occurredAt,
    kind,
    actorId: schedule.userId,
    occurredAt,
    data: {
      scheduleId: schedule.id,
      action,
      jobType: schedule.jobType,
      nextRunAt: schedule.nextRunAt,
      enabled: schedule.enabled,
    },
  };
}
