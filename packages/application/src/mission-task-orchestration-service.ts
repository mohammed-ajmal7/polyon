import type { ActorId, DomainEvent, Task, TaskStatus } from "@polyon/contracts";

import { getReadyTaskIds, markTaskReady } from "@polyon/core";

import type { DomainStoreTransactionContext, DomainUnitOfWork, EventStore, TaskStore } from "@polyon/storage";

export interface AdvanceMissionTasksInput {
  readonly missionId: string;
  readonly actorId: ActorId;
  readonly now: string;
}

export interface AdvanceMissionTasksResult {
  readonly changed: readonly Task[];
  readonly blocked: readonly Task[];
}

export interface MissionTaskOrchestrationServiceDependencies {
  readonly tasks: TaskStore;
  readonly events: EventStore;
  readonly unitOfWork?: DomainUnitOfWork;
}

type MissionTaskStores = Pick<DomainStoreTransactionContext, "tasks" | "events">;

function appendTaskStatusChangedEvent(
  events: EventStore,
  task: Task,
  from: TaskStatus,
  to: TaskStatus,
  actorId: ActorId,
  occurredAt: string,
): DomainEvent {
  const event: DomainEvent = {
    id: `TASK_STATUS_CHANGED:${task.id}:${from}:${to}:${occurredAt}`,
    kind: "TASK_STATUS_CHANGED",
    actorId,
    missionId: task.missionId,
    taskId: task.id,
    occurredAt,
    data: { from, to },
  };
  events.append(event);
  return event;
}

export class MissionTaskOrchestrationService {
  constructor(private readonly dependencies: MissionTaskOrchestrationServiceDependencies) {}

  advanceReadyTasks(input: AdvanceMissionTasksInput): AdvanceMissionTasksResult {
    const operation = (stores: MissionTaskStores) => {
      const missionTasks = stores.tasks.list().filter((task) => task.missionId === input.missionId);
      const readyIds = new Set(getReadyTaskIds(missionTasks));
      const changed: Task[] = [];

      for (const task of missionTasks) {
        if (!readyIds.has(task.id)) continue;

        const dependencies = missionTasks
          .filter((dependency) => task.dependsOn.includes(dependency.id))
          .map((dependency) => ({ id: dependency.id, status: dependency.status }));

        const updated = markTaskReady(task, dependencies, input.now);
        stores.tasks.save(updated);
        appendTaskStatusChangedEvent(
          stores.events,
          updated,
          task.status,
          updated.status,
          input.actorId,
          input.now,
        );
        changed.push(updated);
      }

      return {
        changed,
        blocked: missionTasks.filter(
          (task) =>
            (task.status === "PENDING" || task.status === "BLOCKED") &&
            !readyIds.has(task.id),
        ),
      };
    };

    return this.dependencies.unitOfWork === undefined
      ? operation(this.dependencies)
      : this.dependencies.unitOfWork.transaction(operation);
  }
}
