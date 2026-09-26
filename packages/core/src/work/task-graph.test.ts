import { describe, expect, it } from "vitest";

import { validateTaskGraph } from "./task-graph";

function createTask(id: string, dependsOn: readonly string[] = []) {
  return {
    id,
    missionId: "mission-1",
    kind: "CODING" as const,
    title: id,
    description: `Task ${id}`,
    status: "PENDING" as const,
    dependsOn,
    createdAt: "2026-09-27T00:00:00.000Z",
    updatedAt: "2026-09-27T00:00:00.000Z",
  };
}

describe("validateTaskGraph", () => {
  it("accepts a valid dependency graph", () => {
    const result = validateTaskGraph([
      createTask("task-1"),
      createTask("task-2", ["task-1"]),
      createTask("task-3", ["task-1", "task-2"]),
    ]);

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("accepts tasks with no dependencies", () => {
    const result = validateTaskGraph([createTask("task-1")]);

    expect(result.valid).toBe(true);
  });

  it("rejects duplicate task IDs", () => {
    const result = validateTaskGraph([createTask("task-1"), createTask("task-1")]);

    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual({
      kind: "DUPLICATE_TASK_ID",
      taskId: "task-1",
    });
  });

  it("rejects a missing dependency", () => {
    const result = validateTaskGraph([createTask("task-1", ["task-2"])]);

    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual({
      kind: "MISSING_DEPENDENCY",
      taskId: "task-1",
      dependencyId: "task-2",
    });
  });

  it("rejects a self dependency", () => {
    const result = validateTaskGraph([createTask("task-1", ["task-1"])]);

    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual({
      kind: "SELF_DEPENDENCY",
      taskId: "task-1",
    });
  });

  it("rejects duplicate dependency references", () => {
    const result = validateTaskGraph([
      createTask("task-1"),
      createTask("task-2", ["task-1", "task-1"]),
    ]);

    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual({
      kind: "DUPLICATE_DEPENDENCY",
      taskId: "task-2",
      dependencyId: "task-1",
    });
  });

  it("rejects a direct dependency cycle", () => {
    const result = validateTaskGraph([
      createTask("task-1", ["task-2"]),
      createTask("task-2", ["task-1"]),
    ]);

    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual({
      kind: "DEPENDENCY_CYCLE",
      taskId: "task-1",
    });
    expect(result.errors).toContainEqual({
      kind: "DEPENDENCY_CYCLE",
      taskId: "task-2",
    });
  });

  it("rejects an indirect dependency cycle", () => {
    const result = validateTaskGraph([
      createTask("task-1", ["task-2"]),
      createTask("task-2", ["task-3"]),
      createTask("task-3", ["task-1"]),
    ]);

    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual({
      kind: "DEPENDENCY_CYCLE",
      taskId: "task-1",
    });
    expect(result.errors).toContainEqual({
      kind: "DEPENDENCY_CYCLE",
      taskId: "task-2",
    });
    expect(result.errors).toContainEqual({
      kind: "DEPENDENCY_CYCLE",
      taskId: "task-3",
    });
  });

  it("does not mark a downstream task as part of a dependency cycle", () => {
    const result = validateTaskGraph([
      createTask("task-1", ["task-2"]),
      createTask("task-2", ["task-3"]),
      createTask("task-3", ["task-2"]),
    ]);

    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual({
      kind: "DEPENDENCY_CYCLE",
      taskId: "task-2",
    });
    expect(result.errors).toContainEqual({
      kind: "DEPENDENCY_CYCLE",
      taskId: "task-3",
    });
    expect(result.errors).not.toContainEqual({
      kind: "DEPENDENCY_CYCLE",
      taskId: "task-1",
    });
  });
});
