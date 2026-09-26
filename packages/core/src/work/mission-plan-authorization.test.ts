import type { Mission, MissionPlanProposal, Policy, Task } from "@polyon/contracts";
import { describe, expect, it } from "vitest";

import {
  authorizeMissionPlanApplication,
  InvalidMissionPlanApplicationError,
  MissionPlanApplicationDeniedError,
} from "./mission-plan-authorization";

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

function createPolicy(effect: "ALLOW" | "DENY" | "REQUIRE_APPROVAL"): Policy {
  return {
    id: "policy-1",
    name: "Mission plan policy",
    description: "Controls mission plan changes.",
    approvalMode: "BALANCED",
    rules: [
      {
        priority: 100,
        action: "PLAN_APPLY",
        riskLevel: "HIGH",
        effect,
      },
    ],
    defaultEffect: "DENY",
    enabled: true,
    createdAt: "2026-09-27T00:00:00.000Z",
    updatedAt: "2026-09-27T00:00:00.000Z",
  };
}

function createInput(policy: Policy): Parameters<typeof authorizeMissionPlanApplication>[0] {
  return {
    proposal,
    mission,
    tasks: [createTask("task-1"), createTask("task-2", ["task-1"])],
    policy,
    decisionId: "decision-1",
    approvalRequestId: "approval-1",
    requestedBy: "agent-1",
    requestedAt: "2026-09-27T01:00:00.000Z",
    evaluatedAt: "2026-09-27T01:00:00.000Z",
    riskLevel: "HIGH",
    expiresAt: "2026-09-27T02:00:00.000Z",
  };
}

describe("authorizeMissionPlanApplication", () => {
  it("returns authorization when policy allows the action", () => {
    const result = authorizeMissionPlanApplication(createInput(createPolicy("ALLOW")));

    expect(result.status).toBe("AUTHORIZED");
    expect(result.policyDecision.action).toBe("PLAN_APPLY");
    expect(result.policyDecision.effect).toBe("ALLOW");
    expect(result.approvalRequest).toBeUndefined();
  });

  it("does not mutate the mission when policy allows the action", () => {
    authorizeMissionPlanApplication(createInput(createPolicy("ALLOW")));

    expect(mission.taskIds).toEqual(["existing-task-1"]);
  });

  it("rejects the action when policy denies it", () => {
    expect(() => authorizeMissionPlanApplication(createInput(createPolicy("DENY")))).toThrow(
      MissionPlanApplicationDeniedError,
    );
  });

  it("exposes the denial decision", () => {
    try {
      authorizeMissionPlanApplication(createInput(createPolicy("DENY")));
      throw new Error("Expected authorization to be denied.");
    } catch (error) {
      expect(error).toBeInstanceOf(MissionPlanApplicationDeniedError);

      expect((error as MissionPlanApplicationDeniedError).decision).toMatchObject({
        action: "PLAN_APPLY",
        riskLevel: "HIGH",
        effect: "DENY",
      });
    }
  });

  it("creates a pending approval request bound to the exact proposal", () => {
    const result = authorizeMissionPlanApplication(createInput(createPolicy("REQUIRE_APPROVAL")));

    expect(result.status).toBe("APPROVAL_REQUIRED");
    expect(result.approvalRequest).toMatchObject({
      id: "approval-1",
      policyId: "policy-1",
      missionId: "mission-1",
      proposalId: "proposal-1",
      requestedBy: "agent-1",
      action: "PLAN_APPLY",
      riskLevel: "HIGH",
      status: "PENDING",
      requestedAt: "2026-09-27T01:00:00.000Z",
      expiresAt: "2026-09-27T02:00:00.000Z",
    });
  });

  it("rejects invalid proposals before policy authorization", () => {
    const invalidProposal: MissionPlanProposal = {
      ...proposal,
      taskIds: ["task-1", "missing-task"],
    };

    expect(() =>
      authorizeMissionPlanApplication({
        ...createInput(createPolicy("ALLOW")),
        proposal: invalidProposal,
        tasks: [createTask("task-1")],
      }),
    ).toThrow(InvalidMissionPlanApplicationError);
  });

  it("uses the policy decision produced for the specific action", () => {
    const result = authorizeMissionPlanApplication(createInput(createPolicy("ALLOW")));

    expect(result.policyDecision.id).toBe("decision-1");
    expect(result.policyDecision.action).toBe("PLAN_APPLY");
    expect(result.policyDecision.riskLevel).toBe("HIGH");
  });
});
