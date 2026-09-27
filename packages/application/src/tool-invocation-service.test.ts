import type { Policy, Tool } from "@polyon/contracts";
import { describe, expect, it, vi } from "vitest";

import { InMemoryToolAdapterRegistry, InMemoryToolRegistry, type ToolAdapter } from "@polyon/tools";
import { InMemoryDomainStores, InMemoryEventStore } from "@polyon/storage";

import { ToolInvocationService, type InvokeToolInput } from "./tool-invocation-service";

const tool: Tool = {
  id: "tool-1",
  name: "Terminal",
  description: "Controlled terminal tool.",
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

const baseInput: InvokeToolInput = {
  invocationId: "invocation-1",
  toolId: "tool-1",
  input: { value: "hello" },
  action: "TERMINAL",
  riskLevel: "MEDIUM",
  policy,
  decisionId: "decision-1",
  approvalRequestId: "approval-1",
  requestedBy: "user-1",
  requestedAt: "2026-09-27T01:01:00.000Z",
  evaluatedAt: "2026-09-27T01:01:00.000Z",
  actorId: "agent-1",
  missionId: "mission-1",
  taskId: "task-1",
  executionId: "execution-1",
  agentId: "agent-1",
};

function createService(adapter?: ToolAdapter) {
  const tools = new InMemoryToolRegistry();
  const adapters = new InMemoryToolAdapterRegistry();
  const stores = new InMemoryDomainStores();
  const events = new InMemoryEventStore();

  tools.register(tool);
  if (adapter !== undefined) {
    adapters.register(adapter);
  }

  return {
    stores,
    events,
    service: new ToolInvocationService({
      tools,
      adapters,
      approvals: stores.approvals,
      policyDecisions: stores.policyDecisions,
      events,
    }),
  };
}

describe("ToolInvocationService", () => {
  it("executes an allowed tool only after policy authorization", async () => {
    const invoke = vi.fn(async ({ input }) => ({ output: { received: input } }));
    const { stores, events, service } = createService({
      toolId: "tool-1",
      invoke,
    });

    const result = await service.invoke(baseInput);

    expect(result).toMatchObject({
      status: "SUCCEEDED",
      invocationId: "invocation-1",
      toolId: "tool-1",
      output: { received: { value: "hello" } },
    });
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(stores.policyDecisions.get("decision-1")?.effect).toBe("ALLOW");
    expect(events.listByExecution("execution-1").map((event) => event.kind)).toEqual([
      "POLICY_DECIDED",
      "TOOL_INVOKED",
      "TOOL_INVOKED",
    ]);
  });

  it("denies the tool without invoking its adapter", async () => {
    const invoke = vi.fn(async () => ({ output: "should not run" }));
    const { stores, events, service } = createService({
      toolId: "tool-1",
      invoke,
    });

    const result = await service.invoke({
      ...baseInput,
      policy: { ...policy, defaultEffect: "DENY" },
    });

    expect(result.status).toBe("REJECTED");
    expect(invoke).not.toHaveBeenCalled();
    expect(stores.policyDecisions.get("decision-1")?.effect).toBe("DENY");
    expect(events.get("TOOL_INVOKED:invocation-1:REJECTED")?.data).toMatchObject({
      status: "REJECTED",
    });
  });

  it("creates approval instead of invoking, then executes only after approval", async () => {
    const invoke = vi.fn(async () => ({ output: "executed" }));
    const { stores, events, service } = createService({
      toolId: "tool-1",
      invoke,
    });

    const awaiting = await service.invoke({
      ...baseInput,
      policy: { ...policy, defaultEffect: "REQUIRE_APPROVAL" },
    });

    expect(awaiting.status).toBe("APPROVAL_REQUIRED");
    expect(invoke).not.toHaveBeenCalled();
    expect(stores.approvals.get("approval-1")).toMatchObject({
      toolId: "tool-1",
      status: "PENDING",
    });

    const approved = service.resolveApproval({
      approvalId: "approval-1",
      status: "APPROVED",
      resolvedAt: "2026-09-27T01:02:00.000Z",
      resolvedBy: "user-1",
    });

    expect(approved.status).toBe("APPROVED");

    const result = await service.invokeApproved({
      invocationId: "invocation-1",
      approvalId: "approval-1",
      toolId: "tool-1",
      input: { value: "hello" },
    });

    expect(result.status).toBe("SUCCEEDED");
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(events.listByExecution("execution-1").map((event) => event.kind)).toEqual([
      "POLICY_DECIDED",
      "APPROVAL_REQUESTED",
      "APPROVAL_RESOLVED",
      "TOOL_INVOKED",
      "TOOL_INVOKED",
    ]);
  });

  it("cannot use an approval for another tool", async () => {
    const invoke = vi.fn(async () => ({ output: "should not run" }));
    const { service } = createService({
      toolId: "tool-1",
      invoke,
    });

    await service.invoke({
      ...baseInput,
      policy: { ...policy, defaultEffect: "REQUIRE_APPROVAL" },
    });
    service.resolveApproval({
      approvalId: "approval-1",
      status: "APPROVED",
      resolvedAt: "2026-09-27T01:02:00.000Z",
      resolvedBy: "user-1",
    });

    await expect(
      service.invokeApproved({
        invocationId: "invocation-2",
        approvalId: "approval-1",
        toolId: "tool-2",
        input: {},
      }),
    ).rejects.toMatchObject({ kind: "TOOL_APPROVAL_TOOL_MISMATCH" });

    expect(invoke).not.toHaveBeenCalled();
  });

  it("fails closed when no adapter exists", async () => {
    const { events, service } = createService();

    const result = await service.invoke(baseInput);

    expect(result).toMatchObject({
      status: "FAILED",
      error: "No adapter is registered for tool: tool-1.",
    });
    expect(events.get("TOOL_INVOKED:invocation-1:FAILED")?.data).toMatchObject({
      status: "FAILED",
      toolId: "tool-1",
    });
  });

  it("cannot use an approval for another invocation", async () => {
    const invoke = vi.fn(async () => ({ output: "should not run" }));
    const { service } = createService({
      toolId: "tool-1",
      invoke,
    });

    await service.invoke({
      ...baseInput,
      policy: { ...policy, defaultEffect: "REQUIRE_APPROVAL" },
    });
    service.resolveApproval({
      approvalId: "approval-1",
      status: "APPROVED",
      resolvedAt: "2026-09-27T01:02:00.000Z",
      resolvedBy: "user-1",
    });

    await expect(
      service.invokeApproved({
        invocationId: "invocation-2",
        approvalId: "approval-1",
        toolId: "tool-1",
        input: { value: "hello" },
      }),
    ).rejects.toMatchObject({
      kind: "TOOL_APPROVAL_INVOCATION_MISMATCH",
    });

    expect(invoke).not.toHaveBeenCalled();
  });

  it("does not execute the same invocation twice", async () => {
    const invoke = vi.fn(async () => ({ output: "executed" }));
    const { service } = createService({
      toolId: "tool-1",
      invoke,
    });

    await service.invoke(baseInput);
    await expect(service.invoke(baseInput)).rejects.toMatchObject({
      kind: "TOOL_INVOCATION_ALREADY_RECORDED",
    });
    expect(invoke).toHaveBeenCalledTimes(1);
  });
});
