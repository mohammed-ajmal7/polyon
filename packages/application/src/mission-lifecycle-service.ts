import type {
  ActorId,
  DomainEvent,
  EventId,
  Mission,
  MissionStatus,
  Task,
} from "@polyon/contracts";

import { transitionMissionStatus } from "@polyon/core";
import type { EventStore, MissionStore, TaskStore } from "@polyon/storage";

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

function deriveProgressStatus(tasks: readonly Task[]): MissionStatus | undefined {
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

export class MissionLifecycleService {
  constructor(private readonly dependencies: MissionLifecycleServiceDependencies) {}

  transition(input: TransitionMissionStatusInput): MissionStatusTransitionResult {
    const mission = this.dependencies.missions.get(input.missionId);

    if (mission === undefined) {
      throw new MissionLifecycleServiceError(
        "MISSION_NOT_FOUND",
        `Mission not found: ${input.missionId}.`,
      );
    }

    if (this.dependencies.events.get(input.eventId) !== undefined) {
      throw new MissionLifecycleServiceError(
        "EVENT_EXISTS",
        `Mission status event already exists: ${input.eventId}.`,
      );
    }

    const updatedMission = transitionMissionStatus(mission, input.to, input.now);

    this.dependencies.missions.save(updatedMission);

    const event = appendMissionStatusChangedEvent(
      this.dependencies.events,
      updatedMission,
      mission.status,
      updatedMission.status,
      input.actorId,
      input.eventId,
      input.causedByEventId,
    );

    return {
      mission: updatedMission,
      event,
    };
  }

  syncProgress(input: SyncMissionProgressInput): MissionProgressSyncResult {
    const mission = this.dependencies.missions.get(input.missionId);

    if (mission === undefined) {
      throw new MissionLifecycleServiceError(
        "MISSION_NOT_FOUND",
        `Mission not found: ${input.missionId}.`,
      );
    }

    if (isTerminal(mission.status)) {
      return {
        changed: false,
        mission,
      };
    }

    const tasks = loadMissionTasks(mission, this.dependencies.tasks);
    const nextStatus = deriveProgressStatus(tasks);

    if (nextStatus === undefined || nextStatus === mission.status) {
      return {
        changed: false,
        mission,
      };
    }

    if (this.dependencies.events.get(input.eventId) !== undefined) {
      throw new MissionLifecycleServiceError(
        "EVENT_EXISTS",
        `Mission status event already exists: ${input.eventId}.`,
      );
    }

    const updatedMission = transitionMissionStatus(mission, nextStatus, input.now);
    this.dependencies.missions.save(updatedMission);

    const event = appendMissionStatusChangedEvent(
      this.dependencies.events,
      updatedMission,
      mission.status,
      updatedMission.status,
      input.actorId,
      input.eventId,
      input.causedByEventId,
    );

    return {
      changed: true,
      mission: updatedMission,
      event,
    };
  }
}
