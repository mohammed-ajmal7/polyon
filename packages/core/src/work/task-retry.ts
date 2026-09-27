import type { Task } from "@polyon/contracts";

import { areTaskDependenciesSatisfied, type TaskDependency } from "./task-readiness";
import { transitionTaskStatus } from "./task-transition";

export type TaskRetryErrorKind = "TASK_NOT_FAILED" | "TASK_DEPENDENCIES_NOT_SATISFIED";

export class TaskRetryError extends Error {
  readonly kind: TaskRetryErrorKind;

  constructor(kind: TaskRetryErrorKind, message: string) {
    super(message);
    this.name = "TaskRetryError";
    this.kind = kind;
  }
}

export function retryTask(task: Task, dependencies: readonly TaskDependency[], now: string): Task {
  if (task.status !== "FAILED") {
    throw new TaskRetryError("TASK_NOT_FAILED", `Cannot retry task with status: ${task.status}.`);
  }

  if (!areTaskDependenciesSatisfied(task, dependencies)) {
    throw new TaskRetryError(
      "TASK_DEPENDENCIES_NOT_SATISFIED",
      "Cannot retry task because its dependencies are not satisfied.",
    );
  }

  return transitionTaskStatus(task, "READY", now);
}
