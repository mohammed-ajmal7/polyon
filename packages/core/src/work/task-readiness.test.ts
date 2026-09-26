import { describe, expect, it } from "vitest";

import { areTaskDependenciesSatisfied } from "./task-readiness";

const baseTask = {
  id: "task-3",
  missionId: "mission-1",
  kind: "CODING" as const,
  title: "Implement dependent task",
  description: "Requires previous tasks to succeed",
  status: "PENDING" as const,
  dependsOn: ["task-1", "task-2"],
  createdAt: "2026-09-27T00:00:00.000Z",
  updatedAt: "2026-09-27T00:00:00.000Z",
};

describe("areTaskDependenciesSatisfied", () => {
  it("returns true when a task has no dependencies", () => {
    const task = {
      ...baseTask,
      dependsOn: [],
    };

    expect(areTaskDependenciesSatisfied(task, [])).toBe(true);
  });

  it("returns true when all dependencies succeeded", () => {
    expect(
      areTaskDependenciesSatisfied(baseTask, [
        { id: "task-1", status: "SUCCEEDED" },
        { id: "task-2", status: "SUCCEEDED" },
      ]),
    ).toBe(true);
  });

  it("returns false when one dependency has not succeeded", () => {
    expect(
      areTaskDependenciesSatisfied(baseTask, [
        { id: "task-1", status: "SUCCEEDED" },
        { id: "task-2", status: "RUNNING" },
      ]),
    ).toBe(false);
  });

  it("returns false when a dependency failed", () => {
    expect(
      areTaskDependenciesSatisfied(baseTask, [
        { id: "task-1", status: "SUCCEEDED" },
        { id: "task-2", status: "FAILED" },
      ]),
    ).toBe(false);
  });

  it("returns false when a dependency is missing", () => {
    expect(areTaskDependenciesSatisfied(baseTask, [{ id: "task-1", status: "SUCCEEDED" }])).toBe(
      false,
    );
  });

  it("ignores unrelated tasks", () => {
    expect(
      areTaskDependenciesSatisfied(baseTask, [
        { id: "task-1", status: "SUCCEEDED" },
        { id: "task-2", status: "SUCCEEDED" },
        { id: "task-99", status: "FAILED" },
      ]),
    ).toBe(true);
  });
});
