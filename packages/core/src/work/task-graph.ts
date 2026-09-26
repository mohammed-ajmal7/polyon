import type { Task } from "@polyon/contracts";

export type TaskGraphValidationError =
  | {
      readonly kind: "DUPLICATE_TASK_ID";
      readonly taskId: string;
    }
  | {
      readonly kind: "MISSING_DEPENDENCY";
      readonly taskId: string;
      readonly dependencyId: string;
    }
  | {
      readonly kind: "SELF_DEPENDENCY";
      readonly taskId: string;
    }
  | {
      readonly kind: "DUPLICATE_DEPENDENCY";
      readonly taskId: string;
      readonly dependencyId: string;
    }
  | {
      readonly kind: "DEPENDENCY_CYCLE";
      readonly taskId: string;
    };

export interface TaskGraphValidationResult {
  readonly valid: boolean;
  readonly errors: readonly TaskGraphValidationError[];
}

export function validateTaskGraph(tasks: readonly Task[]): TaskGraphValidationResult {
  const errors: TaskGraphValidationError[] = [];
  const taskIds = new Set<string>();

  for (const task of tasks) {
    if (taskIds.has(task.id)) {
      errors.push({
        kind: "DUPLICATE_TASK_ID",
        taskId: task.id,
      });
    }

    taskIds.add(task.id);
  }

  for (const task of tasks) {
    const dependencyIds = new Set<string>();

    for (const dependencyId of task.dependsOn) {
      if (dependencyIds.has(dependencyId)) {
        errors.push({
          kind: "DUPLICATE_DEPENDENCY",
          taskId: task.id,
          dependencyId,
        });
      }

      dependencyIds.add(dependencyId);

      if (!taskIds.has(dependencyId)) {
        errors.push({
          kind: "MISSING_DEPENDENCY",
          taskId: task.id,
          dependencyId,
        });
      }

      if (dependencyId === task.id) {
        errors.push({
          kind: "SELF_DEPENDENCY",
          taskId: task.id,
        });
      }
    }
  }

  const taskById = new Map(tasks.map((task) => [task.id, task]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const traversalStack: string[] = [];
  const cycleTasks = new Set<string>();

  function visit(taskId: string): void {
    if (visiting.has(taskId)) {
      const cycleStart = traversalStack.indexOf(taskId);

      if (cycleStart !== -1) {
        for (const cycleTaskId of traversalStack.slice(cycleStart)) {
          cycleTasks.add(cycleTaskId);
        }
      }

      return;
    }

    if (visited.has(taskId)) {
      return;
    }

    const task = taskById.get(taskId);

    if (task === undefined) {
      return;
    }

    visiting.add(taskId);
    traversalStack.push(taskId);

    for (const dependencyId of task.dependsOn) {
      visit(dependencyId);
    }

    traversalStack.pop();
    visiting.delete(taskId);
    visited.add(taskId);
  }

  for (const task of tasks) {
    visit(task.id);
  }

  for (const taskId of cycleTasks) {
    errors.push({
      kind: "DEPENDENCY_CYCLE",
      taskId,
    });
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
