import type { ActorId, Mission, Policy, Task } from "@polyon/contracts";

import { retryTask, type TaskDependency } from "@polyon/core";

import type { EventStore, TaskStore } from "@polyon/storage";

import {
  MissionExecutionService,
  type DispatchReadyTasksResult,
} from "./mission-execution-service";

export interface RetryFailedTaskInput {
  readonly mission: Mission;
  readonly taskId: Task["id"];
  readonly actorId: ActorId;
  readonly agentId?: string;
  readonly policy: Policy;
  readonly requestedBy: ActorId;
  readonly now: string;
  readonly riskLevel: "LOW" | "MEDIUM" | "HIGH";
  readonly expiresAt?: string;
  readonly identities: Parameters<MissionExecutionService["dispatchReadyTasks"]>[0]["identities"];
}

export class ExecutionRetryService {
  constructor(
    private readonly tasks: TaskStore,
    private readonly events: EventStore,
    private readonly executionService: MissionExecutionService,
  ) {}

  retryFailedTask(input: RetryFailedTaskInput): DispatchReadyTasksResult {
    const task = this.tasks.get(input.taskId);

    if (task === undefined) {
      throw new Error(`Task not found: ${input.taskId}.`);
    }

    if (task.missionId !== input.mission.id) {
      throw new Error(
        `Task ${input.taskId} does not belong to mission ${input.mission.id}.`,
      );
    }

    if (task.status !== "FAILED") {
      throw new Error(`Cannot retry task with status: ${task.status}.`);
    }

    const missionTasks = input.mission.taskIds
      .map((taskId) => this.tasks.get(taskId))
      .filter((candidate): candidate is Task => candidate !== undefined);

    const dependencies: readonly TaskDependency[] = missionTasks.map((candidate) => ({
      id: candidate.id,
      status: candidate.status,
    }));

    const retried = retryTask(task, dependencies, input.now);
    this.tasks.save(retried);

    this.events.append({
      id: `TASK_STATUS_CHANGED:${task.id}:FAILED:READY:${input.now}`,
      kind: "TASK_STATUS_CHANGED",
      actorId: input.actorId,
      missionId: task.missionId,
      taskId: task.id,
      occurredAt: input.now,
      data: {
        from: "FAILED",
        to: "READY",
      },
    });

    return this.executionService.dispatchReadyTasks({
      mission: input.mission,
      tasks: missionTasks.map((candidate) =>
        candidate.id === retried.id ? retried : candidate,
      ),
      actorId: input.actorId,
      agentId: input.agentId,
      policy: input.policy,
      requestedBy: input.requestedBy,
      now: input.now,
      riskLevel: input.riskLevel,
      expiresAt: input.expiresAt,
      identities: input.identities,
    });
  }
}
