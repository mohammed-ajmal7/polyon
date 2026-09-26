import type { ApprovalRequest } from "@polyon/contracts";
import { describe, expect, it } from "vitest";

import { InvalidApprovalTransitionError, transitionApprovalStatus } from "./approval-transition";

const request: ApprovalRequest = {
  id: "approval-1",
  policyId: "policy-1",
  policyDecisionId: "decision-1",
  action: "WRITE",
  riskLevel: "HIGH",
  requestedBy: "agent-1",
  reason: "Approval required.",
  status: "PENDING",
  requestedAt: "2026-09-27T01:00:00.000Z",
};

describe("transitionApprovalStatus", () => {
  it("approves a pending request", () => {
    const updated = transitionApprovalStatus(
      request,
      "APPROVED",
      "2026-09-27T01:05:00.000Z",
      "human-1",
    );

    expect(updated.status).toBe("APPROVED");
    expect(updated.resolvedAt).toBe("2026-09-27T01:05:00.000Z");
    expect(updated.resolvedBy).toBe("human-1");
  });

  it("rejects a pending request", () => {
    const updated = transitionApprovalStatus(
      request,
      "REJECTED",
      "2026-09-27T01:05:00.000Z",
      "human-1",
    );

    expect(updated.status).toBe("REJECTED");
    expect(updated.resolvedAt).toBe("2026-09-27T01:05:00.000Z");
    expect(updated.resolvedBy).toBe("human-1");
  });

  it("does not mutate the original request", () => {
    const updated = transitionApprovalStatus(
      request,
      "APPROVED",
      "2026-09-27T01:05:00.000Z",
      "human-1",
    );

    expect(request.status).toBe("PENDING");
    expect(request.resolvedAt).toBeUndefined();
    expect(updated).not.toBe(request);
  });

  it("rejects changing a terminal approval", () => {
    const approvedRequest: ApprovalRequest = {
      ...request,
      status: "APPROVED",
    };

    expect(() =>
      transitionApprovalStatus(approvedRequest, "REJECTED", "2026-09-27T01:05:00.000Z", "human-1"),
    ).toThrow(InvalidApprovalTransitionError);
  });
});
