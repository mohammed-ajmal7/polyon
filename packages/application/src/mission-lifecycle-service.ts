import type {
  ActorId,
  DomainEvent,
  EventId,
  Mission,
  MissionStatus,
  Task,
} from "@polyon/contracts";

import { canTransitionMission, transitionMissionStatus } from "@polyon/core";
import type {
  DomainStoreTransactionContext,
  DomainUnitOfWork,
  EventStore,
  MissionStore,
  TaskStore,
} from "@polyon/storage";

export interface TransitionMissionStatusInput {
  readonly missionId: string;
  readonly to: MissionStatus;
  readonly actorId: ActorId;
  readonly eventId: EventId;
  readonly now: string;
  readonly causedByEventId?: EventId;
}

export interface SyncMissionProgressInput {
  readonly missionId: string;
  readonly actorId: ActorId;
  readonly eventId: EventId;
  readonly now: string;
  readonly causedByEventId?: EventId;
}

export interface MissionStatusTransitionResult {
  readonly mission: Mission;
  readonly event: DomainEvent;
}

export interface MissionProgressSyncResult {
  readonly changed: boolean;
  readonly mission: Mission;
  readonly event?: DomainEvent;
}

export interface MissionLifecycleServiceDependencies {
  readonly missions: MissionStore;
  readonly tasks: TaskStore;
  readonly events: EventStore;
}

export type MissionLifecycleServiceErrorKind =
  | "MISSION_NOT_FOUND"
  | "EVENT_EXISTS"
  | "TASK_NOT_FOUND"
  | "TASK_MISSION_MISMATCH";

export class MissionLifecycleServiceError extends Error {
  readonly kind: MissionLifecycleServiceErrorKind;

  constructor(kind: MissionLifecycleServiceErrorKind, message: string) {
    super(message);
    this.name = "MissionLifecycleServiceError";
    this.kind = kind;
  }
}

function isTerminal(status: MissionStatus): boolean {
  return status === "SUCCEEDED" || status === "FAILED" || status === "CANCELLED";
}

function deriveProgressStatus(
  missionStatus: MissionStatus,
  tasks: readonly Task[],
): MissionStatus | undefined {
  if (tasks.length === 0) {
    return undefined;
  }

  if (tasks.every((task) => task.status === "SUCCEEDED")) {
    return "SUCCEEDED";
  }

  if (tasks.some((task) => task.status === "CANCELLED")) {
    return "CANCELLED";
  }

  if (tasks.some((task) => task.status === "REJECTED")) {
    return "FAILED";
  }

  if (tasks.some((task) => task.status === "RUNNING" || task.status === "APPROVED")) {
    return "RUNNING";
  }

  if (tasks.some((task) => task.status === "APPROVAL_REQUIRED")) {
    return "WAITING";
  }

  if (
    (missionStatus === "RUNNING" || missionStatus === "WAITING") &&
    tasks.some(
      (task) =>
        task.status === "PENDING" ||
        task.status === "BLOCKED" ||
        task.status === "READY" ||
        task.status === "FAILED" ||
        task.status === "PAUSED",
    )
  ) {
    return "WAITING";
  }

  return undefined;
}

function appendMissionStatusChangedEvent(
  events: EventStore,
  mission: Mission,
  from: MissionStatus,
  to: MissionStatus,
  actorId: ActorId,
  eventId: EventId,
  causedByEventId: EventId | undefined,
): DomainEvent {
  const event: DomainEvent = {
    id: eventId,
    kind: "MISSION_STATUS_CHANGED",
    actorId,
    missionId: mission.id,
    occurredAt: mission.updatedAt,
    ...(causedByEventId !== undefined ? { causedByEventId } : {}),
    data: {
      from,
      to,
    },
  };

  events.append(event);
  return event;
}

function loadMissionTasks(
  mission: Mission,
  taskStore: TaskStore,
): readonly Task[] {
  return mission.taskIds.map((taskId) => {
    const task = taskStore.get(taskId);

    if (task === undefined) {
      throw new MissionLifecycleServiceError(
        "TASK_NOT_FOUND",
        `Mission ${mission.id} references a task that is not persisted: ${taskId}.`,
      );
    }

    if (task.missionId !== mission.id) {
      throw new MissionLifecycleServiceError(
        "TASK_MISSION_MISMATCH",
        `Task ${task.id} belongs to mission ${task.missionId}, not mission ${mission.id}.`,
      );
    }

    return task;
  });
}

export interface MissionLifecycleServiceDependencies {
  readonly missions: MissionStore;
  readonly tasks: TaskStore;
  readonly events: EventStore;
  readonly unitOfWork?: DomainUnitOfWork;
}

export class MissionLifecycleService {
  constructor(private readonly dependencies: MissionLifecycleServiceDependencies) {}

  transition(input: TransitionMissionStatusInput): MissionStatusTransitionResult {
    const operation = (
      stores: Pick<DomainStoreTransactionContext, "missions" | "tasks" | "events">,
    ) => this.transitionWithStores(stores, input);

    return this.dependencies.unitOfWork === undefined
      ? operation(this.dependencies)
      : this.dependencies.unitOfWork.transaction(operation);
  }

  private transitionWithStores(
    stores: Pick<DomainStoreTransactionContext, "missions" | "tasks" | "events">,
    input: TransitionMissionStatusInput,
  ): MissionStatusTransitionResult {
    // replaced below
  }
}
