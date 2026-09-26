import { describe, expect, it } from "vitest";

import { createMissionPlanProposal } from "./mission-plan-proposal";

describe("createMissionPlanProposal", () => {
  it("creates an independent proposal snapshot", () => {
    const taskIds = ["task-1", "task-2"];

    const proposal = createMissionPlanProposal({
      id: "proposal-1",
      missionId: "mission-1",
      taskIds,
      rationale: "Split research and implementation into separate tasks.",
      createdBy: "agent-1",
      createdAt: "2026-09-27T01:00:00.000Z",
    });

    expect(proposal.id).toBe("proposal-1");
    expect(proposal.missionId).toBe("mission-1");
    expect(proposal.taskIds).toEqual(["task-1", "task-2"]);
    expect(proposal.rationale).toBe("Split research and implementation into separate tasks.");
    expect(proposal.createdBy).toBe("agent-1");
    expect(proposal.createdAt).toBe("2026-09-27T01:00:00.000Z");
  });

  it("copies task IDs instead of retaining the caller's array", () => {
    const taskIds = ["task-1", "task-2"];

    const proposal = createMissionPlanProposal({
      id: "proposal-1",
      missionId: "mission-1",
      taskIds,
      rationale: "Test proposal.",
      createdBy: "agent-1",
      createdAt: "2026-09-27T01:00:00.000Z",
    });

    taskIds.push("task-3");

    expect(proposal.taskIds).toEqual(["task-1", "task-2"]);
  });
});
