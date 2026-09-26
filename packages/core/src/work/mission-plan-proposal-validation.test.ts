import type { Mission, MissionPlanProposal, Task } from "@polyon/contracts";
import { describe, expect, it } from "vitest";

import { validateMissionPlanProposal } from "./mission-plan-proposal-validation";

const mission: Mission = {
  id: "mission-1",
  objective: "Build POLYON",
  constraints: [],
  status: "PLANNING",
  taskIds: ["existing-task-1"],
  createdAt: "2026-09-27T00:00:00.000Z",
  updatedAt: "2026-09-27T00:00:00.000Z",
};

const proposal: MissionPlanProposal = {
  id: "proposal-1",
  missionId: "mission-1",
  taskIds: ["task-1", "task-2"],
  rationale: "Build the system in two stages.",
  createdBy: "agent-1",
  createdAt: "2026-09-27T01:00:00.000Z",
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

describe("validateMissionPlanProposal", () => {
  it("accepts a valid candidate plan even when it differs from the current mission plan", () => {
    const result = validateMissionPlanProposal(proposal, mission, [
      createTask("task-1"),
      createTask("task-2", ["task-1"]),
    ]);

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("rejects a proposal for another mission", () => {
    const invalidProposal: MissionPlanProposal = {
      ...proposal,
      missionId: "mission-2",
    };

    const result = validateMissionPlanProposal(invalidProposal, mission, [
      createTask("task-1"),
      createTask("task-2"),
    ]);

    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual({
      kind: "PROPOSAL_MISSION_MISMATCH",
      expectedMissionId: "mission-1",
      actualMissionId: "mission-2",
    });
  });

  it("rejects a proposal referencing a task that is not supplied", () => {
    const invalidProposal: MissionPlanProposal = {
      ...proposal,
      taskIds: ["task-1", "task-3"],
    };

    const result = validateMissionPlanProposal(invalidProposal, mission, [
      createTask("task-1"),
      createTask("task-2"),
    ]);

    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual({
      kind: "MISSING_PROPOSAL_TASK",
      taskId: "task-3",
    });
  });

  it("rejects duplicate task IDs in a proposal", () => {
    const invalidProposal: MissionPlanProposal = {
      ...proposal,
      taskIds: ["task-1", "task-1"],
    };

    const result = validateMissionPlanProposal(invalidProposal, mission, [createTask("task-1")]);

    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual({
      kind: "DUPLICATE_PROPOSAL_TASK_ID",
      taskId: "task-1",
    });
  });

  it("rejects a proposed task belonging to another mission", () => {
    const result = validateMissionPlanProposal(proposal, mission, [
      createTask("task-1"),
      createTask("task-2", [], "mission-2"),
    ]);

    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual({
      kind: "PROPOSAL_TASK_MISSION_MISMATCH",
      taskId: "task-2",
      expectedMissionId: "mission-1",
      actualMissionId: "mission-2",
    });
  });

  it("rejects dependencies that are not part of the proposed plan", () => {
    const result = validateMissionPlanProposal(proposal, mission, [
      createTask("task-1", ["task-3"]),
      createTask("task-2"),
      createTask("task-3"),
    ]);

    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual({
      kind: "MISSING_DEPENDENCY",
      taskId: "task-1",
      dependencyId: "task-3",
    });
  });

  it("rejects a dependency cycle in the proposed plan", () => {
    const result = validateMissionPlanProposal(proposal, mission, [
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
});
