import type { ApprovalRequest, Mission, MissionPlanProposal, Task } from "@polyon/contracts";
import { describe, expect, it } from "vitest";

import {
  applyApprovedMissionPlanProposal,
  ApprovedMissionPlanApplicationError,
} from "./approved-mission-plan-application";

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

function createTask(id: string, dependsOn: readonly string[] = []): Task {
  return {
    id,
    missionId: "mission-1",
    kind: "CODING",
    title: id,
    description: `Task ${id}`,
    status: "PENDING",
    dependsOn,
    createdAt: "2026-09-27T00:00:00.000Z",
    updatedAt: "2026-09-27T00:00:00.000Z",
  };
}

function createApproval(overrides: Partial<ApprovalRequest> = {}): ApprovalRequest {
  return {
    id: "approval-1",
    policyId: "policy-1",
    policyDecisionId: "decision-1",
    missionId: "mission-1",
    proposalId: "proposal-1",
    action: "PLAN_APPLY",
    riskLevel: "HIGH",
    requestedBy: "agent-1",
    reason: "Policy requires human approval.",
    status: "APPROVED",
    requestedAt: "2026-09-27T01:00:00.000Z",
    resolvedAt: "2026-09-27T01:30:00.000Z",
    resolvedBy: "human-1",
    ...overrides,
  };
}

const evaluatedAt = "2026-09-27T01:45:00.000Z";

function apply(
  approval: ApprovalRequest = createApproval(),
  proposalToApply: MissionPlanProposal = proposal,
  missionToApply: Mission = mission,
  tasks: readonly Task[] = [createTask("task-1"), createTask("task-2", ["task-1"])],
  at = evaluatedAt,
): Mission {
  return applyApprovedMissionPlanProposal(approval, proposalToApply, missionToApply, tasks, at);
}

describe("applyApprovedMissionPlanProposal", () => {
  it("applies an approved proposal", () => {
    const result = apply();

    expect(result).not.toBe(mission);
    expect(result.taskIds).toEqual(["task-1", "task-2"]);
    expect(result.id).toBe("mission-1");
  });

  it("does not mutate the original mission", () => {
    apply(createApproval(), proposal, mission, [createTask("task-1"), createTask("task-2")]);

    expect(mission.taskIds).toEqual(["existing-task-1"]);
    expect(mission.updatedAt).toBe("2026-09-27T00:00:00.000Z");
  });

  it.each(["PENDING", "REJECTED", "EXPIRED", "CANCELLED"] as const)(
    "rejects approval with status %s",
    (status) => {
      expect(() => apply(createApproval({ status }))).toThrowError(
        expect.objectContaining({
          kind: "APPROVAL_NOT_APPROVED",
        }),
      );
    },
  );

  it("rejects an approved request after its expiry", () => {
    const approval = createApproval({
      expiresAt: "2026-09-27T01:40:00.000Z",
    });

    expect(() => apply(approval)).toThrowError(
      expect.objectContaining({
        kind: "APPROVAL_EXPIRED",
      }),
    );
  });

  it("accepts an approved request before its expiry", () => {
    const approval = createApproval({
      expiresAt: "2026-09-27T02:00:00.000Z",
    });

    const result = apply(approval);

    expect(result.taskIds).toEqual(["task-1", "task-2"]);
  });

  it("rejects an approved request exactly at its expiry", () => {
    const approval = createApproval({
      expiresAt: evaluatedAt,
    });

    expect(() => apply(approval)).toThrowError(
      expect.objectContaining({
        kind: "APPROVAL_EXPIRED",
      }),
    );
  });

  it("allows an approval without an expiry", () => {
    const approval = createApproval({
      expiresAt: undefined,
    });

    const result = apply(approval);

    expect(result.taskIds).toEqual(["task-1", "task-2"]);
  });

  it("rejects an approval for the wrong action", () => {
    expect(() => apply(createApproval({ action: "WRITE" }))).toThrowError(
      expect.objectContaining({
        kind: "APPROVAL_ACTION_MISMATCH",
      }),
    );
  });

  it("rejects an approval bound to another mission", () => {
    expect(() => apply(createApproval({ missionId: "mission-2" }))).toThrowError(
      expect.objectContaining({
        kind: "APPROVAL_MISSION_MISMATCH",
      }),
    );
  });

  it("rejects an approval bound to another proposal", () => {
    expect(() => apply(createApproval({ proposalId: "proposal-2" }))).toThrowError(
      expect.objectContaining({
        kind: "APPROVAL_PROPOSAL_MISMATCH",
      }),
    );
  });

  it("rejects an approval without a proposal binding", () => {
    expect(() => apply(createApproval({ proposalId: undefined }))).toThrowError(
      expect.objectContaining({
        kind: "APPROVAL_PROPOSAL_MISMATCH",
      }),
    );
  });

  it("rejects an approval without a mission binding", () => {
    expect(() => apply(createApproval({ missionId: undefined }))).toThrowError(
      expect.objectContaining({
        kind: "APPROVAL_MISSION_MISMATCH",
      }),
    );
  });

  it("rejects an invalid proposal even when the approval is valid", () => {
    const invalidProposal: MissionPlanProposal = {
      ...proposal,
      taskIds: ["task-1", "missing-task"],
    };

    expect(() =>
      apply(createApproval(), invalidProposal, mission, [createTask("task-1")]),
    ).toThrowError(
      expect.objectContaining({
        kind: "INVALID_PROPOSAL",
      }),
    );
  });

  it("preserves validation details through the approval bridge", () => {
    const invalidProposal: MissionPlanProposal = {
      ...proposal,
      taskIds: ["task-1", "missing-task"],
    };

    try {
      apply(createApproval(), invalidProposal, mission, [createTask("task-1")]);

      throw new Error("Expected application to fail.");
    } catch (error) {
      expect(error).toBeInstanceOf(ApprovedMissionPlanApplicationError);
      expect((error as ApprovedMissionPlanApplicationError).kind).toBe("INVALID_PROPOSAL");
    }
  });
});
