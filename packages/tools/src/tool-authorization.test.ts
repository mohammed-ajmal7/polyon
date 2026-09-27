import type { Policy, Tool } from "@polyon/contracts";
import { describe, expect, it } from "vitest";

import {
  authorizeToolInvocation,
  ToolAuthorizationError,
} from "./tool-authorization";

const tool: Tool = {
  id: "tool-1",
  name: "Terminal",
  description: "Runs controlled terminal commands.",
  kind: "TERMINAL",
  actionKinds: ["TERMINAL"],
  enabled: true,
};

const policy: Policy = {
  id: "policy-1",
  name: "Tool policy",
  description: "Controls tool access.",
  approvalMode: "BALANCED",
  rules: [],
  defaultEffect: "ALLOW",
  enabled: true,
  createdAt: "2026-09-27T01:00:00.000Z",
  updatedAt: "2026-09-27T01:00:00.000Z",
};

const baseInput = {
  tool,
  policy,
  action: "TERMINAL" as const,
  riskLevel: "MEDIUM" as const,
  decisionId: "decision-1",
  approvalRequestId: "approval-1",
  requestedBy: "user-1",
  requestedAt: "2026-09-27T01:01:00.000Z",
  evaluatedAt: "2026-09-27T01:01:00.000Z",
  actorId: "user-1",
  missionId: "mission-1",
  taskId: "task-1",
  executionId: "execution-1",
  agentId: "agent-1",
};

describe("authorizeToolInvocation", () => {
  it("authorizes an enabled supported tool when policy allows", () => {
    const result = authorizeToolInvocation(baseInput);

    expect(result.status).toBe("AUTHORIZED");
    expect(result.policyDecision.action).toBe("TERMINAL");
    expect(result.policyDecision.effect).toBe("ALLOW");
  });

  it("rejects disabled tools before policy evaluation", () => {
    expect(() =>
      authorizeToolInvocation({
        ...baseInput,
        tool: {
          ...tool,
          enabled: false,
        },
        policy: {
          ...policy,
          defaultEffect: "ALLOW",
        },
      }),
    ).toThrowError(
      expect.objectContaining({
        kind: "TOOL_DISABLED",
      }),
    );
  });

  it("rejects unsupported tool actions before policy evaluation", () => {
    expect(() =>
      authorizeToolInvocation({
        ...baseInput,
        action: "WRITE",
      }),
    ).toThrowError(
      expect.objectContaining({
        kind: "TOOL_ACTION_NOT_SUPPORTED",
      }),
    );
  });

  it("denies tool invocation when policy denies it", () => {
    expect(() =>
      authorizeToolInvocation({
        ...baseInput,
        policy: {
          ...policy,
          defaultEffect: "DENY",
        },
      }),
    ).toThrowError(
      expect.objectContaining({
        kind: "TOOL_INVOCATION_DENIED",
      }),
    );
  });

  it("exposes the denied policy decision", () => {
    try {
      authorizeToolInvocation({
        ...baseInput,
        policy: {
          ...policy,
          defaultEffect: "DENY",
        },
      });
      throw new Error("Expected tool authorization to fail.");
    } catch (error) {
      expect(error).toBeInstanceOf(ToolAuthorizationError);
      expect(error).toMatchObject({
        kind: "TOOL_INVOCATION_DENIED",
        decision: {
          id: "decision-1",
          policyId: "policy-1",
          action: "TERMINAL",
          riskLevel: "MEDIUM",
          effect: "DENY",
        },
      });
    }
  });

  it("creates an approval request with execution context", () => {
    const result = authorizeToolInvocation({
      ...baseInput,
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
      action: "TERMINAL",
      status: "PENDING",
    });
  });
});
