import type { Agent, Execution, Mission, Policy, Task } from "@polyon/contracts";
import { InMemoryIntegrationAdapterRegistry, type IntegrationAdapter } from "@polyon/integrations";
import { InMemoryDomainStores } from "@polyon/storage";
import { describe, expect, it, vi } from "vitest";

import { AgentToolOrchestrationService } from "./agent-tool-orchestration-service";
import { IntegrationInvocationService } from "./integration-invocation-service";
import { ToolInvocationService } from "./tool-invocation-service";
import type { AgentGateway } from "@polyon/agents";

const now = "2026-09-27T03:00:00.000Z";

const agent: Agent = {
  id: "agent.telegram",
  name: "Telegram agent",
  role: "Communication agent",
  description: "Sends approved Telegram messages.",
  status: "ACTIVE",
  capabilityIds: ["text.generate"],
  preferredModelId: "model.telegram",
  fallbackModelIds: [],
  createdAt: now,
  updatedAt: now,
};

const mission: Mission = {
  id: "mission.telegram",
  objective: "Send an approved message.",
  constraints: [],
  status: "RUNNING",
  taskIds: ["task.telegram"],
  createdAt: now,
  updatedAt: now,
};

const task: Task = {
  id: "task.telegram",
  missionId: mission.id,
  kind: "OTHER",
  title: "Send message",
  description: "Send an approved Telegram message.",
  status: "PAUSED",
  dependsOn: [],
  createdAt: now,
  updatedAt: now,
};

const execution: Execution = {
  id: "execution.telegram",
  missionId: mission.id,
  taskId: task.id,
  actorId: "actor.telegram",
  agentId: agent.id,
  attempt: 1,
  status: "PAUSED",
  createdAt: now,
  updatedAt: now,
};

const policy: Policy = {
  id: "policy.telegram",
  name: "Telegram approval",
  description: "Requires a human approval before communication.",
  approvalMode: "BALANCED",
  rules: [],
  defaultEffect: "REQUIRE_APPROVAL",
  enabled: true,
  createdAt: now,
  updatedAt: now,
};

describe("agent-driven integration approval", () => {
  it("reconciles an uncertain non-idempotent integration without replaying it", async () => {
    const stores = new InMemoryDomainStores();
    stores.tasks.save(task);
    stores.executions.save(execution);

    let externalCalls = 0;
    const integrations = new InMemoryIntegrationAdapterRegistry();
    integrations.register({
      integrationId: "telegram-primary",
      kind: "TELEGRAM",
      actionKinds: ["EXTERNAL_COMMUNICATION"],
      supportedOperations: ["SEND_MESSAGE"],
      sideEffectClass: "NON_IDEMPOTENT",
      async invoke() {
        externalCalls += 1;
        return { output: { messageId: 99 } };
      },
    });

    const gateway = {
      async invokeText() {
        return {
          agentId: agent.id,
          modelId: "model.telegram",
          providerId: "provider.telegram",
          source: "PREFERRED" as const,
          output: {
            content: "The message was already sent.",
            finishReason: "STOP" as const,
          },
        };
      },
    } as unknown as AgentGateway;

    const tools = new (await import("@polyon/tools")).InMemoryToolRegistry();
    const adapters = new (await import("@polyon/tools")).InMemoryToolAdapterRegistry();
    const toolInvocation = new ToolInvocationService({
      tools,
      adapters,
      approvals: stores.approvals,
      policyDecisions: stores.policyDecisions,
      events: stores.events,
      unitOfWork: stores,
    });
    const integrationInvocation = new IntegrationInvocationService({
      integrations,
      approvals: stores.approvals,
      policyDecisions: stores.policyDecisions,
      events: stores.events,
      unitOfWork: stores,
    });
    const orchestrator = new AgentToolOrchestrationService({
      agentGateway: gateway,
      toolInvocation,
      integrationInvocation,
      integrations,
      tools,
      approvals: stores.approvals,
      executions: stores.executions,
      tasks: stores.tasks,
      events: stores.events,
      unitOfWork: stores,
      enqueueExecution: () => {},
    });

    stores.approvals.save({
      id: "approval-reconcile",
      policyId: policy.id,
      policyDecisionId: "decision-reconcile",
      executionId: execution.id,
      integrationId: "telegram-primary",
      invocationId: "tool-call:reconcile",
      action: "EXTERNAL_COMMUNICATION",
      riskLevel: "MEDIUM",
      requestedBy: execution.actorId,
      reason: "Possible side effect.",
      status: "APPROVED",
      requestedAt: now,
      resolvedAt: now,
      integrationInvocation: {
        operation: "SEND_MESSAGE",
        input: { chatId: 100, text: "hello" },
      },
      integrationContinuation: {
        agentId: agent.id,
        requiredCapabilityIds: ["text.generate"],
        request: {
          messages: [{ role: "USER", content: "Send hello." }],
        },
        response: {
          content: "",
          finishReason: "TOOL_CALL",
          toolCalls: [
            {
              id: "reconcile",
              toolId: "integration.invoke:telegram-primary:SEND_MESSAGE",
              input: { chatId: 100, text: "hello" },
            },
          ],
        },
        toolCall: {
          id: "reconcile",
          toolId: "integration.invoke:telegram-primary:SEND_MESSAGE",
          input: { chatId: 100, text: "hello" },
        },
        rounds: 1,
        integrationId: "telegram-primary",
        operation: "SEND_MESSAGE",
        input: { chatId: 100, text: "hello" },
        sideEffectClass: "NON_IDEMPOTENT",
        state: "RECONCILIATION_REQUIRED",
      },
    });

    const result = await orchestrator.reconcileIntegrationExecution({
      approvalId: "approval-reconcile",
      action: "MARK_COMPLETED",
      resolvedAt: "2026-09-27T03:05:00.000Z",
      output: { messageId: 42 },
    });

    expect(result).toEqual({
      status: "ENQUEUED",
      executionId: execution.id,
    });
    expect(externalCalls).toBe(0);
    expect(stores.approvals.get("approval-reconcile")?.integrationContinuation).toMatchObject({
      state: "AWAITING_MODEL",
      integrationOutput: { messageId: 42 },
    });
    expect(stores.executions.get(execution.id)?.status).toBe("QUEUED");
    expect(stores.tasks.get(task.id)?.status).toBe("RUNNING");
  });

  it("persists an integration continuation, blocks the side effect, then resumes after approval", async () => {
    const stores = new InMemoryDomainStores();
    stores.tasks.save(task);
    stores.executions.save(execution);

    let externalCalls = 0;
    let modelCalls = 0;

    const integration: IntegrationAdapter = {
      integrationId: "telegram-primary",
      kind: "TELEGRAM",
      actionKinds: ["EXTERNAL_COMMUNICATION"],
      supportedOperations: ["SEND_MESSAGE"],
      sideEffectClass: "NON_IDEMPOTENT",
      async invoke() {
        externalCalls += 1;
        return {
          output: {
            messageId: 42,
            chatId: 100,
            text: "hello",
          },
        };
      },
    };

    const integrations = new InMemoryIntegrationAdapterRegistry();
    integrations.register(integration);

    const gateway = {
      async invokeText({ request }: { request: import("@polyon/contracts").TextModelRequest }) {
        modelCalls += 1;

        if (modelCalls === 1) {
          return {
            agentId: agent.id,
            modelId: "model.telegram",
            providerId: "provider.telegram",
            source: "PREFERRED" as const,
            output: {
              content: "",
              finishReason: "TOOL_CALL" as const,
              toolCalls: [
                {
                  id: "telegram-call-1",
                  toolId: "integration.invoke:telegram-primary:SEND_MESSAGE",
                  input: {
                    chatId: 100,
                    text: "hello",
                  },
                },
              ],
            },
          };
        }

        expect(request.messages).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              role: "TOOL",
              content: expect.stringContaining("messageId"),
            }),
          ]),
        );

        return {
          agentId: agent.id,
          modelId: "model.telegram",
          providerId: "provider.telegram",
          source: "PREFERRED" as const,
          output: {
            content: "Telegram message sent.",
            finishReason: "STOP" as const,
          },
        };
      },
    } as unknown as AgentGateway;

    const tools = new (await import("@polyon/tools")).InMemoryToolRegistry();
    const adapters = new (await import("@polyon/tools")).InMemoryToolAdapterRegistry();

    const toolInvocation = new ToolInvocationService({
      tools,
      adapters,
      approvals: stores.approvals,
      policyDecisions: stores.policyDecisions,
      events: stores.events,
      unitOfWork: stores,
    });

    const integrationInvocation = new IntegrationInvocationService({
      integrations,
      approvals: stores.approvals,
      policyDecisions: stores.policyDecisions,
      events: stores.events,
      unitOfWork: stores,
    });

    const orchestrator = new AgentToolOrchestrationService({
      agentGateway: gateway,
      toolInvocation,
      integrationInvocation,
      integrations,
      tools,
      approvals: stores.approvals,
      executions: stores.executions,
      tasks: stores.tasks,
      events: stores.events,
      unitOfWork: stores,
      enqueueExecution: vi.fn(),
    });

    const awaiting = await orchestrator.invoke({
      agentId: agent.id,
      requiredCapabilityIds: ["text.generate"],
      request: {
        messages: [{ role: "USER", content: "Send hello to Telegram." }],
      },
      policy,
      actorId: "actor.telegram",
      missionId: mission.id,
      taskId: task.id,
      executionId: execution.id,
      now: () => now,
    });

    expect(awaiting.status).toBe("APPROVAL_REQUIRED");
    expect(externalCalls).toBe(0);

    const approval = stores.approvals.get("approval:tool-call:telegram-call-1");
    expect(approval?.integrationContinuation).toMatchObject({
      integrationId: "telegram-primary",
      operation: "SEND_MESSAGE",
      sideEffectClass: "NON_IDEMPOTENT",
      state: "AWAITING_INTEGRATION",
    });

    const resolution = await orchestrator.resolveToolApproval({
      approvalId: approval!.id,
      status: "APPROVED",
      resolvedAt: "2026-09-27T03:01:00.000Z",
      resolvedBy: "user.telegram",
    });

    expect(resolution.status).toBe("ENQUEUED");
    expect(externalCalls).toBe(0);

    const result = await orchestrator.resumeApprovedExecution(execution.id, {
      ...policy,
      defaultEffect: "ALLOW",
    });

    expect(result.status).toBe("SUCCEEDED");
    if (result.status === "SUCCEEDED") {
      expect(result.response.content).toBe("Telegram message sent.");
    }
    expect(externalCalls).toBe(1);
    expect(modelCalls).toBe(2);
    expect(stores.approvals.get(approval!.id)?.integrationContinuation?.state).toBe("COMPLETED");
  });
});
