import type { Mission, Task } from "@polyon/contracts";
import { describe, expect, it } from "vitest";

import { validateMissionTaskPlan } from "./mission-plan";

const mission: Mission = {
  id: "mission-1",
  objective: "Build POLYON",
  constraints: [],
  status: "PLANNING",
  taskIds: ["task-1", "task-2"],
  createdAt: "2026-09-27T00:00:00.000Z",
  updatedAt: "2026-09-27T00:00:00.000Z",
};

function createTask(id: string, dependsOn: readonly string[] = [], missionId = "mission-1"): Task {
  return {
    id,
    missionId,
    kind: "CODING",
    title: id,
    description: `Task ${id}`,
    status: "PENDING",
    dependsOn,
    createdAt: "2026-09-27T00:00:00.000Z",
    updatedAt: "2026-09-27T00:00:00.000Z",
  };
}

describe("validateMissionTaskPlan", () => {
  it("accepts a valid mission task plan", () => {
    const result = validateMissionTaskPlan(mission, [
      createTask("task-1"),
      createTask("task-2", ["task-1"]),
    ]);

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("accepts a mission with no tasks", () => {
    const emptyMission: Mission = {
      ...mission,
      taskIds: [],
    };

    const result = validateMissionTaskPlan(emptyMission, []);

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("rejects duplicate mission task IDs", () => {
    const invalidMission: Mission = {
      ...mission,
      taskIds: ["task-1", "task-1"],
    };

    const result = validateMissionTaskPlan(invalidMission, [createTask("task-1")]);

    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual({
      kind: "DUPLICATE_MISSION_TASK_ID",
      taskId: "task-1",
    });
  });

  it("rejects a mission task that is missing from the supplied tasks", () => {
    const result = validateMissionTaskPlan(mission, [createTask("task-1")]);

    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual({
      kind: "MISSING_MISSION_TASK",
      taskId: "task-2",
    });
  });

  it("rejects a supplied task that is not declared by the mission", () => {
    const result = validateMissionTaskPlan(mission, [
      createTask("task-1"),
      createTask("task-2"),
      createTask("task-3"),
    ]);

    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual({
      kind: "UNDECLARED_MISSION_TASK",
      taskId: "task-3",
    });
  });

  it("rejects a task that belongs to another mission", () => {
    const result = validateMissionTaskPlan(mission, [
      createTask("task-1"),
      createTask("task-2", [], "mission-2"),
    ]);

    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual({
      kind: "TASK_MISSION_MISMATCH",
      taskId: "task-2",
      expectedMissionId: "mission-1",
      actualMissionId: "mission-2",
    });
  });

  it("rejects an invalid task dependency graph", () => {
    const result = validateMissionTaskPlan(mission, [
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

  it("reports both mission-plan and graph errors", () => {
    const invalidMission: Mission = {
      ...mission,
      taskIds: ["task-1", "task-3"],
    };

    const result = validateMissionTaskPlan(invalidMission, [
      createTask("task-1", ["task-2"]),
      createTask("task-2", ["task-1"]),
    ]);

    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual({
      kind: "MISSING_MISSION_TASK",
      taskId: "task-3",
    });
    expect(result.errors).toContainEqual({
      kind: "DEPENDENCY_CYCLE",
      taskId: "task-1",
    });
    expect(result.errors).toContainEqual({
      kind: "DEPENDENCY_CYCLE",
      taskId: "task-2",
    });
  });

  it("rejects duplicate task IDs in the supplied task list", () => {
    const duplicateTask = createTask("task-1");

    const result = validateMissionTaskPlan(mission, [
      duplicateTask,
      duplicateTask,
      createTask("task-2"),
    ]);

    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual({
      kind: "DUPLICATE_TASK_ID",
      taskId: "task-1",
    });
  });

  it("accepts tasks in a different order from mission.taskIds", () => {
    const result = validateMissionTaskPlan(mission, [
      createTask("task-2", ["task-1"]),
      createTask("task-1"),
    ]);

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });
});
