import type { ActorId, Execution, ExecutionId, Task } from "@polyon/contracts";

import { areTaskDependenciesSatisfied, type TaskDependency } from "./task-readiness";

export interface CreateExecutionForTaskInput {
  readonly id: ExecutionId;
  readonly actorId: ActorId;
  readonly attempt: number;
  readonly createdAt: string;
}

export type ExecutionCreationErrorKind = "TASK_NOT_READY" | "TASK_DEPENDENCIES_NOT_SATISFIED";

export class ExecutionCreationError extends Error {
  readonly kind: ExecutionCreationErrorKind;

  constructor(kind: ExecutionCreationErrorKind, message: string) {
    super(message);
    this.name = "ExecutionCreationError";
    this.kind = kind;
  }
}

export function createExecutionForTask(
  task: Task,
  dependencies: readonly TaskDependency[],
  input: CreateExecutionForTaskInput,
): Execution {
  if (task.status !== "READY") {
    throw new ExecutionCreationError(
      "TASK_NOT_READY",
      `Cannot create execution for task with status: ${task.status}.`,
    );
  }

  if (!areTaskDependenciesSatisfied(task, dependencies)) {
    throw new ExecutionCreationError(
      "TASK_DEPENDENCIES_NOT_SATISFIED",
      "Cannot create execution because task dependencies are not satisfied.",
    );
  }

  return {
    id: input.id,
    missionId: task.missionId,
    taskId: task.id,
    actorId: input.actorId,
    attempt: input.attempt,
    status: "PENDING",
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
  };
}
