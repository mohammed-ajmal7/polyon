import type { IntegrationAdapter, Policy } from "@polyon/contracts";
import { describe, expect, it } from "vitest";

import {
  authorizeIntegrationInvocation,
  IntegrationAuthorizationError,
} from "./integration-authorization";

const integration: IntegrationAdapter = {
  integrationId: "telegram-primary",
  kind: "TELEGRAM",
  actionKinds: ["EXTERNAL_COMMUNICATION"],
  async invoke() {
    return { output: "ok" };
  },
};

const policy: Policy = {
  id: "policy-1",
  name: "Integration policy",
  description: "Controls external integrations.",
  approvalMode: "BALANCED",
  rules: [],
  defaultEffect: "ALLOW",
  enabled: true,
  createdAt: "2026-09-27T01:00:00.000Z",
  updatedAt: "2026-09-27T01:00:00.000Z",
};

const input = {
  integration,
  action: "EXTERNAL_COMMUNICATION" as const,
  policy,
  riskLevel: "HIGH" as const,
  decisionId: "decision-1",
  approvalRequestId: "approval-1",
  requestedBy: "user-1",
  requestedAt: "2026-09-27T01:01:00.000Z",
  evaluatedAt: "2026-09-27T01:01:00.000Z",
  actorId: "user-1",
  missionId: "mission-1",
  taskId: "task-1",
  executionId: "execution-1",
};

describe("authorizeIntegrationInvocation", () => {
  it("authorizes a supported integration action", () => {
    expect(authorizeIntegrationInvocation(input)).toMatchObject({
      integrationId: "telegram-primary",
      status: "AUTHORIZED",
      policyDecision: {
        action: "EXTERNAL_COMMUNICATION",
        effect: "ALLOW",
      },
    });
  });

  it("rejects an unsupported integration action", () => {
    expect(() =>
      authorizeIntegrationInvocation({
        ...input,
        action: "DELETE",
      }),
    ).toThrowError(
      new IntegrationAuthorizationError(
        "INTEGRATION_ACTION_NOT_SUPPORTED",
        "Integration does not support action: DELETE.",
      ),
    );
  });

  it("denies integration invocation when policy denies it", () => {
    expect(() =>
      authorizeIntegrationInvocation({
        ...input,
        policy: {
          ...policy,
          defaultEffect: "DENY",
        },
      }),
    ).toThrowError(
      expect.objectContaining({
        kind: "INTEGRATION_INVOCATION_DENIED",
      }),
    );
  });

  it("creates a pending approval request for approval-required integrations", () => {
    const result = authorizeIntegrationInvocation({
      ...input,
      policy: {
        ...policy,
        defaultEffect: "REQUIRE_APPROVAL",
      },
    });

    expect(result.status).toBe("APPROVAL_REQUIRED");
    expect(result.approvalRequest).toMatchObject({
      missionId: "mission-1",
      taskId: "task-1",
      executionId: "execution-1",
      action: "EXTERNAL_COMMUNICATION",
      riskLevel: "HIGH",
      status: "PENDING",
    });
  });

  it("retains the integration identity in the authorization result", () => {
    expect(authorizeIntegrationInvocation(input).integrationId).toBe(
      "telegram-primary",
    );
  });

  it("exposes denied policy decision details", () => {
    try {
      authorizeIntegrationInvocation({
        ...input,
        policy: {
          ...policy,
          defaultEffect: "DENY",
        },
      });
    } catch (error) {
      expect(error).toBeInstanceOf(IntegrationAuthorizationError);
      expect(error).toMatchObject({
        decision: {
          id: "decision-1",
          action: "EXTERNAL_COMMUNICATION",
          riskLevel: "HIGH",
          effect: "DENY",
        },
      });
    }
  });
});
