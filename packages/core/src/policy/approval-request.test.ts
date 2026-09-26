import { describe, expect, it } from "vitest";

import { ApprovalNotRequiredError, createApprovalRequest } from "./approval-request";

const decision = {
  id: "decision-1",
  policyId: "policy-1",
  action: "WRITE" as const,
  riskLevel: "HIGH" as const,
  effect: "REQUIRE_APPROVAL" as const,
  reason: "High-risk write requires human approval.",
  evaluatedAt: "2026-09-27T01:00:00.000Z",
};

describe("createApprovalRequest", () => {
  it("creates a pending approval request from a requiring decision", () => {
    const request = createApprovalRequest(decision, {
      id: "approval-1",
      requestedBy: "agent-1",
      requestedAt: "2026-09-27T01:01:00.000Z",
      missionId: "mission-1",
      taskId: "task-1",
      executionId: "execution-1",
      expiresAt: "2026-09-27T02:01:00.000Z",
    });

    expect(request.id).toBe("approval-1");
    expect(request.policyId).toBe("policy-1");
    expect(request.policyDecisionId).toBe("decision-1");
    expect(request.action).toBe("WRITE");
    expect(request.riskLevel).toBe("HIGH");
    expect(request.requestedBy).toBe("agent-1");
    expect(request.reason).toBe("High-risk write requires human approval.");
    expect(request.status).toBe("PENDING");
    expect(request.requestedAt).toBe("2026-09-27T01:01:00.000Z");
    expect(request.expiresAt).toBe("2026-09-27T02:01:00.000Z");
    expect(request.missionId).toBe("mission-1");
    expect(request.taskId).toBe("task-1");
    expect(request.executionId).toBe("execution-1");
  });

  it("rejects approval requests for allowed actions", () => {
    const allowedDecision = {
      ...decision,
      effect: "ALLOW" as const,
    };

    expect(() =>
      createApprovalRequest(allowedDecision, {
        id: "approval-1",
        requestedBy: "agent-1",
        requestedAt: "2026-09-27T01:01:00.000Z",
      }),
    ).toThrow(ApprovalNotRequiredError);
  });

  it("rejects approval requests for denied actions", () => {
    const deniedDecision = {
      ...decision,
      effect: "DENY" as const,
    };

    expect(() =>
      createApprovalRequest(deniedDecision, {
        id: "approval-1",
        requestedBy: "agent-1",
        requestedAt: "2026-09-27T01:01:00.000Z",
      }),
    ).toThrow(ApprovalNotRequiredError);
  });
});
