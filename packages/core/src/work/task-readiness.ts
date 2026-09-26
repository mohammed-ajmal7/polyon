import type { Task, TaskStatus } from "@polyon/contracts";

export interface TaskDependency {
  readonly id: Task["id"];
  readonly status: TaskStatus;
}

export function areTaskDependenciesSatisfied(
  task: Task,
  dependencies: readonly TaskDependency[],
): boolean {
  if (task.dependsOn.length === 0) {
    return true;
  }

  const dependencyStatuses = new Map(
    dependencies.map((dependency) => [dependency.id, dependency.status]),
  );

  return task.dependsOn.every(
    (dependencyId) => dependencyStatuses.get(dependencyId) === "SUCCEEDED",
  );
}
