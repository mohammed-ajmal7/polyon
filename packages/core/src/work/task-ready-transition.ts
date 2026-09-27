import type { Task } from "@polyon/contracts";

import { areTaskDependenciesSatisfied, type TaskDependency } from "./task-readiness";
import { transitionTaskStatus } from "./task-transition";

export type TaskReadyErrorKind = "TASK_NOT_PENDING_OR_BLOCKED" | "TASK_DEPENDENCIES_NOT_SATISFIED";

export class TaskReadyError extends Error {
  readonly kind: TaskReadyErrorKind;

  constructor(kind: TaskReadyErrorKind, message: string) {
    super(message);
    this.name = "TaskReadyError";
    this.kind = kind;
  }
}

export function markTaskReady(
  task: Task,
  dependencies: readonly TaskDependency[],
  readyAt: string,
): Task {
  if (task.status !== "PENDING" && task.status !== "BLOCKED") {
    throw new TaskReadyError(
      "TASK_NOT_PENDING_OR_BLOCKED",
      `Cannot mark task ready from status: ${task.status}.`,
    );
  }

  if (!areTaskDependenciesSatisfied(task, dependencies)) {
    throw new TaskReadyError(
      "TASK_DEPENDENCIES_NOT_SATISFIED",
      "Cannot mark task ready because task dependencies are not satisfied.",
    );
  }

  return transitionTaskStatus(task, "READY", readyAt);
}
