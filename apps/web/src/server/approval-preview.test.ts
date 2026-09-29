import type { ApprovalRequest } from "@polyon/contracts";
import { describe, expect, it } from "vitest";

import { buildApprovalPreview, explainApprovalReason } from "./approval-preview";

const base = {
  id: "approval-1",
  policyId: "policy",
  policyDecisionId: "decision",
  action: "READ",
  riskLevel: "LOW",
  requestedBy: "local-user",
  reason: "No policy rule matched; using the policy default effect.",
  status: "PENDING",
  requestedAt: "2026-09-29T00:00:00.000Z",
} as unknown as ApprovalRequest;

describe("buildApprovalPreview", () => {
  it("describes a tool call with its exact input and the request that caused it", () => {
    const preview = buildApprovalPreview({
      ...base,
      toolId: "memory.search.scoped",
      toolContinuation: {
        agentId: "primary-action-agent",
        requiredCapabilityIds: [],
        request: { messages: [{ role: "USER", content: "What did I save about taxes?" }] },
        response: { content: "" },
        toolCall: { id: "call-1", toolId: "memory.search.scoped", input: { query: "taxes" } },
        rounds: 0,
        state: "AWAITING_TOOL",
      },
    } as unknown as ApprovalRequest);

    expect(preview).toMatchObject({
      title: "Search your POLYON memory",
      requestedFor: "What did I save about taxes?",
      agentId: "primary-action-agent",
    });
    expect(preview.input).toContain('"query": "taxes"');
  });

  it("shows integration input with secret-looking fields redacted at any depth", () => {
    const preview = buildApprovalPreview({
      ...base,
      integrationId: "email-primary",
      integrationInvocation: {
        operation: "SEND_EMAIL",
        input: { to: ["a@example.com"], body: "Hi", auth: { password: "hunter2" } },
      },
    });

    expect(preview.title).toBe("Send an email");
    expect(preview.input).toContain("a@example.com");
    expect(preview.input).not.toContain("hunter2");
    expect(preview.input).toContain("[redacted]");
  });

  it("names plan approvals in plain language", () => {
    expect(
      buildApprovalPreview({ ...base, action: "PLAN_APPLY" } as unknown as ApprovalRequest).title,
    ).toBe("Start a mission plan");
  });

  it("bounds very large inputs", () => {
    const preview = buildApprovalPreview({
      ...base,
      integrationId: "telegram",
      integrationInvocation: { operation: "SEND_MESSAGE", input: { text: "x".repeat(10_000) } },
    });

    expect(preview.input?.length).toBeLessThanOrEqual(2_001);
  });
});

describe("explainApprovalReason", () => {
  it("replaces the default policy reason", () => {
    expect(explainApprovalReason(base.reason)).toMatch(/approval settings/);
    expect(explainApprovalReason("Sending email is high risk.")).toBe(
      "Sending email is high risk.",
    );
  });
});
