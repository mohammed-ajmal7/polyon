import type { Mission, MissionPlanProposal, Task } from "@polyon/contracts";
import { describe, expect, it } from "vitest";

import {
  applyMissionPlanProposal,
  InvalidMissionPlanProposalError,
} from "./mission-plan-application";

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

describe("applyMissionPlanProposal", () => {
  it("applies a valid proposal to a new mission object", () => {
    const result = applyMissionPlanProposal(proposal, mission, [
      createTask("task-1"),
      createTask("task-2", ["task-1"]),
    ]);

    expect(result).not.toBe(mission);
    expect(result.taskIds).toEqual(["task-1", "task-2"]);
    expect(result.id).toBe(mission.id);
    expect(result.objective).toBe(mission.objective);
    expect(result.status).toBe(mission.status);
    expect(result.createdAt).toBe(mission.createdAt);
  });

  it("uses the supplied application timestamp", () => {
    const result = applyMissionPlanProposal(
      proposal,
      mission,
      [createTask("task-1"), createTask("task-2")],
      "2026-09-27T01:15:00.000Z",
    );

    expect(result.updatedAt).toBe("2026-09-27T01:15:00.000Z");
  });

  it("does not mutate the original mission", () => {
    applyMissionPlanProposal(proposal, mission, [createTask("task-1"), createTask("task-2")]);

    expect(mission.taskIds).toEqual(["existing-task-1"]);
    expect(mission.updatedAt).toBe("2026-09-27T00:00:00.000Z");
  });

  it("copies proposal task IDs into the new mission", () => {
    const result = applyMissionPlanProposal(proposal, mission, [
      createTask("task-1"),
      createTask("task-2"),
    ]);

    expect(result.taskIds).not.toBe(proposal.taskIds);
    expect(result.taskIds).toEqual(proposal.taskIds);
  });

  it("rejects a proposal that cannot be validated", () => {
    const invalidProposal: MissionPlanProposal = {
      ...proposal,
      taskIds: ["task-1", "missing-task"],
    };

    expect(() =>
      applyMissionPlanProposal(invalidProposal, mission, [createTask("task-1")]),
    ).toThrow(InvalidMissionPlanProposalError);
  });

  it("exposes validation errors on rejection", () => {
    const invalidProposal: MissionPlanProposal = {
      ...proposal,
      taskIds: ["task-1", "missing-task"],
    };

    try {
      applyMissionPlanProposal(invalidProposal, mission, [createTask("task-1")]);
      throw new Error("Expected proposal application to fail.");
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidMissionPlanProposalError);

      expect((error as InvalidMissionPlanProposalError).errors).toContainEqual({
        kind: "MISSING_PROPOSAL_TASK",
        taskId: "missing-task",
      });
    }
  });

  it("rejects a proposal with a dependency cycle", () => {
    const cyclicProposal: MissionPlanProposal = {
      ...proposal,
      taskIds: ["task-1", "task-2"],
    };

    expect(() =>
      applyMissionPlanProposal(cyclicProposal, mission, [
        createTask("task-1", ["task-2"]),
        createTask("task-2", ["task-1"]),
      ]),
    ).toThrow(InvalidMissionPlanProposalError);
  });
});
