import type { IntegrationAdapter } from "@polyon/integrations";
import type { Policy } from "@polyon/contracts";
import { InMemoryIntegrationAdapterRegistry } from "@polyon/integrations";
import { InMemoryDomainStores } from "@polyon/storage";
import { describe, expect, it, vi } from "vitest";

import {
  IntegrationInvocationService,
  IntegrationInvocationServiceError,
} from "./integration-invocation-service";

const policy: Policy = {
  id: "policy.integration",
  name: "Integration policy",
  description: "Controls external integration calls.",
  approvalMode: "BALANCED",
  rules: [],
  defaultEffect: "ALLOW",
  enabled: true,
  createdAt: "2026-09-27T01:00:00.000Z",
  updatedAt: "2026-09-27T01:00:00.000Z",
};

function createService(adapter: IntegrationAdapter) {
  const stores = new InMemoryDomainStores();
  const integrations = new InMemoryIntegrationAdapterRegistry();
  integrations.register(adapter);

  return {
    stores,
    service: new IntegrationInvocationService({
      integrations,
      approvals: stores.approvals,
      policyDecisions: stores.policyDecisions,
      events: stores.events,
      unitOfWork: stores,
    }),
  };
}

const baseInput = {
  invocationId: "integration-invocation-1",
  integrationId: "telegram-primary",
  operation: "send_message",
  input: { text: "hello" },
  action: "EXTERNAL_COMMUNICATION" as const,
  riskLevel: "HIGH" as const,
  policy,
  decisionId: "integration-decision-1",
  approvalRequestId: "integration-approval-1",
  requestedBy: "actor-1",
  requestedAt: "2026-09-27T01:01:00.000Z",
  evaluatedAt: "2026-09-27T01:01:00.000Z",
  actorId: "actor-1",
  missionId: "mission-1",
  taskId: "task-1",
  executionId: "execution-1",
  agentId: "agent-1",
};

describe("IntegrationInvocationService", () => {
  it("executes an allowed integration and records a durable trace", async () => {
    const invoke = vi.fn(async () => ({ output: { sent: true } }));
    const { stores, service } = createService({
      integrationId: "telegram-primary",
      kind: "TELEGRAM",
      actionKinds: ["EXTERNAL_COMMUNICATION"],
      supportedOperations: ["send_message"],
      invoke,
    });

    const result = await service.invoke(baseInput);

    expect(result.status).toBe("SUCCEEDED");
    if (result.status === "SUCCEEDED") {
      expect(result.output).toEqual({ sent: true });
    }
    expect(invoke).toHaveBeenCalledOnce();
    expect(invoke).toHaveBeenCalledWith({
      invocationId: "integration-invocation-1",
      operation: "send_message",
      input: { text: "hello" },
    });
    expect(stores.policyDecisions.get("integration-decision-1")).toMatchObject({
      action: "EXTERNAL_COMMUNICATION",
      riskLevel: "HIGH",
      effect: "ALLOW",
    });
    expect(
      stores.events.get("INTEGRATION_INVOKED:integration-invocation-1:SUCCEEDED"),
    ).toMatchObject({
      kind: "INTEGRATION_INVOKED",
      executionId: "execution-1",
      data: {
        integrationId: "telegram-primary",
        sideEffectClass: "NON_IDEMPOTENT",
        operation: "send_message",
        status: "SUCCEEDED",
      },
    });
  });

  it("creates approval and does not invoke an integration until approved", async () => {
    const invoke = vi.fn(async () => ({ output: "sent" }));
    const { stores, service } = createService({
      integrationId: "telegram-primary",
      kind: "TELEGRAM",
      actionKinds: ["EXTERNAL_COMMUNICATION"],
      supportedOperations: ["send_message"],
      invoke,
    });

    const awaiting = await service.invoke({
      ...baseInput,
      policy: {
        ...policy,
        defaultEffect: "REQUIRE_APPROVAL",
      },
    });

    expect(awaiting.status).toBe("APPROVAL_REQUIRED");
    expect(invoke).not.toHaveBeenCalled();
    expect(stores.approvals.get("integration-approval-1")).toMatchObject({
      integrationId: "telegram-primary",
      status: "PENDING",
      invocationId: "integration-invocation-1",
    });
    expect(stores.events.get("APPROVAL_REQUESTED:integration-approval-1")?.actorId).toBe("actor-1");

    const approved = service.resolveApproval({
      approvalId: "integration-approval-1",
      status: "APPROVED",
      resolvedAt: "2026-09-27T01:02:00.000Z",
      resolvedBy: "actor-1",
    });

    expect(approved.status).toBe("APPROVED");

    await expect(
      service.invokeApproved({
        invocationId: "integration-invocation-1",
        approvalId: "integration-approval-1",
        integrationId: "telegram-primary",
        operation: "send_message",
        input: { text: "different" },
      }),
    ).rejects.toMatchObject({
      kind: "INTEGRATION_APPROVAL_PAYLOAD_MISMATCH",
    });

    const result = await service.invokeApproved({
      invocationId: "integration-invocation-1",
      approvalId: "integration-approval-1",
      integrationId: "telegram-primary",
      operation: "send_message",
      input: { text: "hello" },
    });

    expect(result.status).toBe("SUCCEEDED");
    expect(invoke).toHaveBeenCalledOnce();
    expect(
      stores.events.get("APPROVAL_RESOLVED:integration-approval-1:2026-09-27T01:02:00.000Z"),
    ).toBeDefined();
  });

  it("rejects approved integration execution after the approval expires", async () => {
    const invoke = vi.fn(async () => ({ output: "sent" }));
    const { stores, service } = createService({
      integrationId: "telegram-primary",
      kind: "TELEGRAM",
      actionKinds: ["EXTERNAL_COMMUNICATION"],
      supportedOperations: ["send_message"],
      invoke,
    });

    await service.invoke({
      ...baseInput,
      policy: {
        ...policy,
        defaultEffect: "REQUIRE_APPROVAL",
      },
      expiresAt: "2026-09-27T00:00:00.000Z",
    });

    service.resolveApproval({
      approvalId: "integration-approval-1",
      status: "APPROVED",
      resolvedAt: "2026-09-27T01:02:00.000Z",
      resolvedBy: "actor-1",
    });

    await expect(
      service.invokeApproved({
        invocationId: "integration-invocation-1",
        approvalId: "integration-approval-1",
        integrationId: "telegram-primary",
        operation: "send_message",
        input: { text: "hello" },
      }),
    ).rejects.toMatchObject({
      kind: "INTEGRATION_APPROVAL_EXPIRED",
    });

    expect(invoke).not.toHaveBeenCalled();
    expect(stores.approvals.get("integration-approval-1")?.status).toBe("APPROVED");
  });

  it("rejects integration approval mismatches and prevents replay", async () => {
    const invoke = vi.fn(async () => ({ output: "sent" }));
    const { service } = createService({
      integrationId: "telegram-primary",
      kind: "TELEGRAM",
      actionKinds: ["EXTERNAL_COMMUNICATION"],
      supportedOperations: ["send_message"],
      invoke,
    });

    await service.invoke({
      ...baseInput,
      policy: {
        ...policy,
        defaultEffect: "REQUIRE_APPROVAL",
      },
    });
    service.resolveApproval({
      approvalId: "integration-approval-1",
      status: "APPROVED",
      resolvedAt: "2026-09-27T01:02:00.000Z",
      resolvedBy: "actor-1",
    });

    await expect(
      service.invokeApproved({
        invocationId: "integration-invocation-1",
        approvalId: "integration-approval-1",
        integrationId: "other-integration",
        operation: "send_message",
        input: { text: "hello" },
      }),
    ).rejects.toMatchObject({
      kind: "INTEGRATION_APPROVAL_INTEGRATION_MISMATCH",
    });

    const result = await service.invokeApproved({
      invocationId: "integration-invocation-1",
      approvalId: "integration-approval-1",
      integrationId: "telegram-primary",
      operation: "send_message",
      input: { text: "hello" },
    });

    expect(result.status).toBe("SUCCEEDED");

    await expect(
      service.invokeApproved({
        invocationId: "integration-invocation-1",
        approvalId: "integration-approval-1",
        integrationId: "telegram-primary",
        operation: "send_message",
        input: { text: "hello" },
      }),
    ).rejects.toBeInstanceOf(IntegrationInvocationServiceError);

    expect(invoke).toHaveBeenCalledOnce();
  });

  it("applies integration-specific policy rules", async () => {
    const invoke = vi.fn(async () => ({ output: "sent" }));
    const { service } = createService({
      integrationId: "telegram-primary",
      kind: "TELEGRAM",
      actionKinds: ["EXTERNAL_COMMUNICATION"],
      supportedOperations: ["send_message"],
      invoke,
    });

    const result = await service.invoke({
      ...baseInput,
      policy: {
        ...policy,
        rules: [
          {
            priority: 100,
            integrationId: "telegram-primary",
            effect: "DENY",
          },
        ],
      },
      invocationId: "integration-invocation-specific-deny",
      approvalRequestId: "integration-approval-specific-deny",
      decisionId: "integration-decision-specific-deny",
    });

    expect(result.status).toBe("REJECTED");
    expect(invoke).not.toHaveBeenCalled();
  });

  it("applies agent-scoped policy rules to integration invocations", async () => {
    const invoke = vi.fn(async () => ({ output: "sent" }));
    const { service, stores } = createService({
      integrationId: "telegram-primary",
      kind: "TELEGRAM",
      actionKinds: ["EXTERNAL_COMMUNICATION"],
      supportedOperations: ["send_message"],
      invoke,
    });

    const result = await service.invoke({
      ...baseInput,
      policy: {
        ...policy,
        rules: [
          {
            priority: 100,
            agentId: "agent-blocked",
            effect: "DENY",
          },
        ],
      },
      agentId: "agent-blocked",
      decisionId: "integration-decision-agent-deny",
      invocationId: "integration-invocation-agent-deny",
      approvalRequestId: "integration-approval-agent-deny",
    });

    expect(result.status).toBe("REJECTED");
    expect(invoke).not.toHaveBeenCalled();
    expect(stores.policyDecisions.get("integration-decision-agent-deny")).toMatchObject({
      effect: "DENY",
    });
    expect(
      stores.events.get("INTEGRATION_INVOKED:integration-invocation-agent-deny:REJECTED"),
    ).toMatchObject({
      data: {
        status: "REJECTED",
        integrationId: "telegram-primary",
      },
    });
  });
});
