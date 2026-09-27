import type { Execution } from "@polyon/contracts";
import { describe, expect, it } from "vitest";

import { authorizeExecutionRun } from "./execution-authorization";
import {
  applyExecutionRunAuthorization,
  ExecutionRunAuthorizationApplicationError,
} from "./execution-run-authorization";

const pendingExecution: Execution = {
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
  defaultEffect: "ALLOW" as const,
  enabled: true,
  createdAt: "2026-09-27T00:00:00.000Z",
  updatedAt: "2026-09-27T00:00:00.000Z",
};

const baseInput = {
  execution: pendingExecution,
  policy: basePolicy,
  decisionId: "decision-1",
  approvalRequestId: "approval-1",
  requestedBy: "user-1",
  requestedAt: "2026-09-27T01:01:00.000Z",
  evaluatedAt: "2026-09-27T01:01:00.000Z",
  riskLevel: "MEDIUM" as const,
};

describe("applyExecutionRunAuthorization", () => {
  it("queues an execution when authorization is granted", () => {
    const authorization = authorizeExecutionRun(baseInput);

    expect(
      applyExecutionRunAuthorization(authorization, pendingExecution, "2026-09-27T01:02:00.000Z"),
    ).toEqual({
      ...pendingExecution,
      status: "QUEUED",
      updatedAt: "2026-09-27T01:02:00.000Z",
    });
  });

  it("rejects an authorized execution with the wrong policy effect", () => {
    expect(() =>
      applyExecutionRunAuthorization(
        {
          status: "AUTHORIZED",
          policyDecision: {
            id: "decision-1",
            policyId: "policy-1",
            action: "EXECUTION_RUN",
            riskLevel: "MEDIUM",
            effect: "DENY",
            reason: "Incorrect synthetic authorization.",
            evaluatedAt: "2026-09-27T01:01:00.000Z",
          },
        },
        pendingExecution,
        "2026-09-27T01:02:00.000Z",
      ),
    ).toThrowError(
      expect.objectContaining({
        kind: "AUTHORIZATION_EFFECT_MISMATCH",
      }),
    );
  });

  it("moves an execution to approval required when approval is required", () => {
    const authorization = authorizeExecutionRun({
      ...baseInput,
      policy: {
        ...basePolicy,
        defaultEffect: "REQUIRE_APPROVAL" as const,
      },
    });

    expect(
      applyExecutionRunAuthorization(authorization, pendingExecution, "2026-09-27T01:02:00.000Z"),
    ).toEqual({
      ...pendingExecution,
      status: "APPROVAL_REQUIRED",
      updatedAt: "2026-09-27T01:02:00.000Z",
    });
  });

  it("rejects an approval-required authorization with the wrong policy effect", () => {
    expect(() =>
      applyExecutionRunAuthorization(
        {
          status: "APPROVAL_REQUIRED",
          policyDecision: {
            id: "decision-1",
            policyId: "policy-1",
            action: "EXECUTION_RUN",
            riskLevel: "MEDIUM",
            effect: "ALLOW",
            reason: "Incorrect synthetic authorization.",
            evaluatedAt: "2026-09-27T01:01:00.000Z",
          },
          approvalRequest: undefined,
        },
        pendingExecution,
        "2026-09-27T01:02:00.000Z",
      ),
    ).toThrowError(
      expect.objectContaining({
        kind: "AUTHORIZATION_EFFECT_MISMATCH",
      }),
    );
  });

  it("requires an approval request for an approval-required authorization", () => {
    const authorization = authorizeExecutionRun({
      ...baseInput,
      policy: {
        ...basePolicy,
        defaultEffect: "REQUIRE_APPROVAL" as const,
      },
    });

    const withoutApprovalRequest = {
      ...authorization,
      approvalRequest: undefined,
    };

    expect(() =>
      applyExecutionRunAuthorization(
        withoutApprovalRequest,
        pendingExecution,
        "2026-09-27T01:02:00.000Z",
      ),
    ).toThrowError(
      expect.objectContaining({
        kind: "MISSING_APPROVAL_REQUEST",
      }),
    );
  });

  it("rejects a non-pending approval", () => {
    const authorization = authorizeExecutionRun({
      ...baseInput,
      policy: {
        ...basePolicy,
        defaultEffect: "REQUIRE_APPROVAL" as const,
      },
    });

    expect(() =>
      applyExecutionRunAuthorization(
        {
          ...authorization,
          approvalRequest: {
            ...authorization.approvalRequest!,
            status: "APPROVED",
          },
        },
        pendingExecution,
        "2026-09-27T01:02:00.000Z",
      ),
    ).toThrowError(
      expect.objectContaining({
        kind: "APPROVAL_STATUS_MISMATCH",
      }),
    );
  });

  it("rejects an approval with the wrong action", () => {
    const authorization = authorizeExecutionRun({
      ...baseInput,
      policy: {
        ...basePolicy,
        defaultEffect: "REQUIRE_APPROVAL" as const,
      },
    });

    expect(() =>
      applyExecutionRunAuthorization(
        {
          ...authorization,
          approvalRequest: {
            ...authorization.approvalRequest!,
            action: "PLAN_APPLY",
          },
        },
        pendingExecution,
        "2026-09-27T01:02:00.000Z",
      ),
    ).toThrowError(
      expect.objectContaining({
        kind: "APPROVAL_ACTION_MISMATCH",
      }),
    );
  });

  it("rejects an approval for another mission", () => {
    const authorization = authorizeExecutionRun({
      ...baseInput,
      policy: {
        ...basePolicy,
        defaultEffect: "REQUIRE_APPROVAL" as const,
      },
    });

    expect(() =>
      applyExecutionRunAuthorization(
        {
          ...authorization,
          approvalRequest: {
            ...authorization.approvalRequest!,
            missionId: "mission-2",
          },
        },
        pendingExecution,
        "2026-09-27T01:02:00.000Z",
      ),
    ).toThrowError(
      expect.objectContaining({
        kind: "APPROVAL_MISSION_MISMATCH",
      }),
    );
  });

  it("rejects an approval for another task", () => {
    const authorization = authorizeExecutionRun({
      ...baseInput,
      policy: {
        ...basePolicy,
        defaultEffect: "REQUIRE_APPROVAL" as const,
      },
    });

    expect(() =>
      applyExecutionRunAuthorization(
        {
          ...authorization,
          approvalRequest: {
            ...authorization.approvalRequest!,
            taskId: "task-2",
          },
        },
        pendingExecution,
        "2026-09-27T01:02:00.000Z",
      ),
    ).toThrowError(
      expect.objectContaining({
        kind: "APPROVAL_TASK_MISMATCH",
      }),
    );
  });

  it("rejects an approval for another execution", () => {
    const authorization = authorizeExecutionRun({
      ...baseInput,
      policy: {
        ...basePolicy,
        defaultEffect: "REQUIRE_APPROVAL" as const,
      },
    });

    expect(() =>
      applyExecutionRunAuthorization(
        {
          ...authorization,
          approvalRequest: {
            ...authorization.approvalRequest!,
            executionId: "execution-2",
          },
        },
        pendingExecution,
        "2026-09-27T01:02:00.000Z",
      ),
    ).toThrowError(
      expect.objectContaining({
        kind: "APPROVAL_EXECUTION_MISMATCH",
      }),
    );
  });

  it("rejects an approval bound to another policy decision", () => {
    const authorization = authorizeExecutionRun({
      ...baseInput,
      policy: {
        ...basePolicy,
        defaultEffect: "REQUIRE_APPROVAL" as const,
      },
    });

    expect(() =>
      applyExecutionRunAuthorization(
        {
          ...authorization,
          approvalRequest: {
            ...authorization.approvalRequest!,
            policyDecisionId: "decision-2",
          },
        },
        pendingExecution,
        "2026-09-27T01:02:00.000Z",
      ),
    ).toThrowError(
      expect.objectContaining({
        kind: "APPROVAL_DECISION_MISMATCH",
      }),
    );
  });

  it("preserves the original execution object", () => {
    const before = structuredClone(pendingExecution);
    const authorization = authorizeExecutionRun(baseInput);

    applyExecutionRunAuthorization(authorization, pendingExecution, "2026-09-27T01:02:00.000Z");

    expect(pendingExecution).toEqual(before);
  });

  it("exposes its error type", () => {
    const authorization = authorizeExecutionRun({
      ...baseInput,
      policy: {
        ...basePolicy,
        defaultEffect: "REQUIRE_APPROVAL" as const,
      },
    });

    expect(() =>
      applyExecutionRunAuthorization(
        {
          ...authorization,
          approvalRequest: undefined,
        },
        pendingExecution,
        "2026-09-27T01:02:00.000Z",
      ),
    ).toThrowError(ExecutionRunAuthorizationApplicationError);
  });
});
