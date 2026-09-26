import type { Execution } from "@polyon/contracts";
import { describe, expect, it } from "vitest";

import {
  authorizeExecutionRun,
  ExecutionRunAuthorizationError,
} from "./execution-authorization";

const execution: Execution = {
  id: "execution-1",
  missionId: "mission-1",
  taskId: "task-1",
  actorId: "agent-1",
  attempt: 1,
  status: "PENDING",
  createdAt: "2026-09-27T01:00:00.000Z",
  updatedAt: "2026-09-27T01:00:00.000Z",
};

const basePolicy = {
  id: "policy-1",
  name: "Execution Policy",
  description: "Policy for execution runs.",
  approvalMode: "BALANCED" as const,
  rules: [],
  defaultEffect: "REQUIRE_APPROVAL" as const,
  enabled: true,
  createdAt: "2026-09-27T00:00:00.000Z",
  updatedAt: "2026-09-27T00:00:00.000Z",
};

const baseInput = {
  execution,
  policy: basePolicy,
  decisionId: "decision-1",
  approvalRequestId: "approval-1",
  requestedBy: "user-1",
  requestedAt: "2026-09-27T01:01:00.000Z",
  evaluatedAt: "2026-09-27T01:01:00.000Z",
  riskLevel: "MEDIUM" as const,
};

describe("authorizeExecutionRun", () => {
  it("authorizes an execution when policy allows the run", () => {
    const result = authorizeExecutionRun({
      ...baseInput,
      policy: {
        ...basePolicy,
        defaultEffect: "ALLOW" as const,
      },
    });

    expect(result).toEqual({
      status: "AUTHORIZED",
      policyDecision: {
        id: "decision-1",
        policyId: "policy-1",
        action: "EXECUTION_RUN",
        riskLevel: "MEDIUM",
        effect: "ALLOW",
        reason: "No policy rule matched; using the policy default effect.",
        evaluatedAt: "2026-09-27T01:01:00.000Z",
      },
    });
  });

  it("does not mutate the execution when authorization succeeds", () => {
    const before = structuredClone(execution);

    authorizeExecutionRun({
      ...baseInput,
      policy: {
        ...basePolicy,
        defaultEffect: "ALLOW" as const,
      },
    });

    expect(execution).toEqual(before);
  });

  it("denies an execution when policy denies the run", () => {
    expect(() =>
      authorizeExecutionRun({
        ...baseInput,
        policy: {
          ...basePolicy,
          defaultEffect: "DENY" as const,
        },
      }),
    ).toThrowError(
      expect.objectContaining({
        kind: "EXECUTION_RUN_DENIED",
      }),
    );
  });

  it("exposes the policy decision when execution is denied", () => {
    try {
      authorizeExecutionRun({
        ...baseInput,
        policy: {
          ...basePolicy,
          defaultEffect: "DENY" as const,
        },
      });
      throw new Error("Expected authorization to fail.");
    } catch (error) {
      expect(error).toBeInstanceOf(ExecutionRunAuthorizationError);
      expect(error).toMatchObject({
        kind: "EXECUTION_RUN_DENIED",
        decision: {
          id: "decision-1",
          policyId: "policy-1",
          action: "EXECUTION_RUN",
          riskLevel: "MEDIUM",
          effect: "DENY",
          evaluatedAt: "2026-09-27T01:01:00.000Z",
        },
      });
    }
  });

  it("creates a pending approval request when policy requires approval", () => {
    const result = authorizeExecutionRun(baseInput);

    expect(result.status).toBe("APPROVAL_REQUIRED");
    expect(result.policyDecision.effect).toBe("REQUIRE_APPROVAL");
    expect(result.approvalRequest).toMatchObject({
      id: "approval-1",
      policyId: "policy-1",
      policyDecisionId: "decision-1",
      missionId: "mission-1",
      taskId: "task-1",
      executionId: "execution-1",
      action: "EXECUTION_RUN",
      riskLevel: "MEDIUM",
      requestedBy: "user-1",
      reason: "No policy rule matched; using the policy default effect.",
      status: "PENDING",
      requestedAt: "2026-09-27T01:01:00.000Z",
    });
  });

  it("preserves an approval expiry when supplied", () => {
    const result = authorizeExecutionRun({
      ...baseInput,
      expiresAt: "2026-09-27T02:01:00.000Z",
    });

    expect(result.approvalRequest?.expiresAt).toBe("2026-09-27T02:01:00.000Z");
  });

  it("rejects non-pending executions before evaluating policy", () => {
    const policy = {
      ...basePolicy,
      defaultEffect: "ALLOW" as const,
    };

    expect(() =>
      authorizeExecutionRun({
        ...baseInput,
        execution: {
          ...execution,
          status: "RUNNING",
        },
        policy,
      }),
    ).toThrowError(
      expect.objectContaining({
        kind: "EXECUTION_NOT_PENDING",
      }),
    );
  });

  it.each([
    "APPROVAL_REQUIRED",
    "APPROVED",
    "QUEUED",
    "RUNNING",
    "PAUSED",
    "SUCCEEDED",
    "FAILED",
    "CANCELLED",
    "REJECTED",
  ] as const)("rejects execution status %s", (status) => {
    expect(() =>
      authorizeExecutionRun({
        ...baseInput,
        execution: {
          ...execution,
          status,
        },
      }),
    ).toThrowError(
      expect.objectContaining({
        kind: "EXECUTION_NOT_PENDING",
      }),
    );
  });
});
