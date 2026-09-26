import type { Task } from "@polyon/contracts";

import { canTransitionTask } from "./task-lifecycle";
import { InvalidStateTransitionError } from "./transition-error";

export function transitionTaskStatus(task: Task, to: Task["status"], now: string): Task {
  if (!canTransitionTask(task.status, to)) {
    throw new InvalidStateTransitionError("task", task.status, to);
  }

  return {
    ...task,
    status: to,
    updatedAt: now,
  };
}
