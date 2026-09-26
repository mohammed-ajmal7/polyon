import type { Task, TaskId } from "@polyon/contracts";

export function getReadyTaskIds(tasks: readonly Task[]): readonly TaskId[] {
  const dependencyStatuses = new Map(tasks.map((task) => [task.id, task.status]));

  return tasks
    .filter((task) => task.status === "PENDING" || task.status === "BLOCKED")
    .filter((task) =>
      task.dependsOn.every((dependencyId) => dependencyStatuses.get(dependencyId) === "SUCCEEDED"),
    )
    .map((task) => task.id);
}
