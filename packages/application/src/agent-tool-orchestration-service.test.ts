import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Agent, AgentId, Model, Policy, Provider, Tool } from "@polyon/contracts";
import type { AgentGateway } from "@polyon/agents";
import { InMemoryToolAdapterRegistry, InMemoryToolRegistry, type ToolAdapter } from "@polyon/tools";
import { FileDomainStores } from "@polyon/storage";
import { describe, expect, it, vi } from "vitest";

import { AgentToolOrchestrationService } from "./agent-tool-orchestration-service";
import { ToolInvocationService } from "./tool-invocation-service";

const now = "2026-09-27T02:00:00.000Z";
const agentId: AgentId = "agent.test";
const tool: Tool = {
  id: "tool.test",
  name: "Test tool",
  description: "A deterministic test tool.",
  kind: "TERMINAL",
  actionKinds: ["TERMINAL"],
  enabled: true,
};

const model: Model = {
  id: "model.test",
  name: "Test model",
  kind: "TEXT",
  providerId: "provider.test",
  capabilityIds: ["text.generate"],
  enabled: true,
};

const agent: Agent = {
  id: agentId,
  name: "Test agent",
  role: "Execution agent",
  description: "Runs tool continuations.",
  status: "ACTIVE",
  capabilityIds: ["text.generate"],
  preferredModelId: model.id,
  fallbackModelIds: [],
  createdAt: now,
  updatedAt: now,
};

const provider: Provider = {
  id: "provider.test",
  name: "Test provider",
  kind: "HOSTED_MODEL",
  enabled: true,
};

const policy: Policy = {
  id: "policy.test",
  name: "Approval policy",
  description: "Requires a human approval before the test tool executes.",
  approvalMode: "BALANCED",
  rules: [],
  defaultEffect: "REQUIRE_APPROVAL",
  enabled: true,
  createdAt: now,
  updatedAt: now,
};

function createOrchestrator(
  stores: FileDomainStores,
  modelInvoke: AgentGateway["invokeText"],
  toolInvoke: ToolAdapter["invoke"],
) {
  const tools = new InMemoryToolRegistry();
  const adapters = new InMemoryToolAdapterRegistry();
  tools.register(tool);
  adapters.register({
    toolId: tool.id,
    invoke: toolInvoke,
  });

  const gateway = {
    invokeText: modelInvoke,
  } as unknown as AgentGateway;

  const toolInvocation = new ToolInvocationService({
    tools,
    adapters,
    approvals: stores.approvals,
    policyDecisions: stores.policyDecisions,
    events: stores.events,
    unitOfWork: stores,
  });

  const orchestrator = new AgentToolOrchestrationService({
    agentGateway: gateway,
    toolInvocation,
    tools,
    approvals: stores.approvals,
    executions: stores.executions,
    tasks: stores.tasks,
    events: stores.events,
    unitOfWork: stores,
    enqueueExecution: vi.fn(),
  });

  return { orchestrator, toolInvocation };
}

describe("AgentToolOrchestrationService", () => {
  it("bounds large tool output before returning it to the model", async () => {
    const root = mkdtempSync(join(tmpdir(), "polyon-tool-output-limit-"));
    let calls = 0;
    let modelToolContent = "";

    try {
      const stores = new FileDomainStores(root);
      const { orchestrator } = createOrchestrator(
        stores,
        vi.fn(async ({ request }) => {
          calls += 1;

          if (calls === 1) {
            return {
              agentId,
              modelId: model.id,
              providerId: provider.id,
              source: "PREFERRED" as const,
              output: {
                content: "",
                finishReason: "TOOL_CALL" as const,
                toolCalls: [
                  {
                    id: "call-large",
                    toolId: tool.id,
                    input: { value: "large" },
                  },
                ],
              },
            };
          }

          const messages = request.messages;
          const toolMessage = messages.find((message) => message.role === "TOOL");
          modelToolContent = toolMessage?.content ?? "";

          return {
            agentId,
            modelId: model.id,
            providerId: provider.id,
            source: "PREFERRED" as const,
            output: {
              content: "done",
              finishReason: "STOP" as const,
            },
          };
        }),
        vi.fn(async () => ({
          output: "x".repeat(2048),
        })),
      );

      const result = await orchestrator.invoke({
        agentId,
        requiredCapabilityIds: ["text.generate"],
        request: {
          messages: [{ role: "USER", content: "Use the tool." }],
        },
        policy: {
          ...policy,
          defaultEffect: "ALLOW",
        },
        actorId: "actor.test",
        maxToolOutputBytes: 128,
      });

      expect(result.status).toBe("SUCCEEDED");
      expect(calls).toBe(2);
      expect(modelToolContent).toContain("[Tool output truncated:");
      expect(new TextEncoder().encode(modelToolContent).byteLength).toBeLessThanOrEqual(128);
      expect(modelToolContent).not.toBe("x".repeat(2048));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("recovers an approved continuation without re-running a completed tool after restart", async () => {
    const root = mkdtempSync(join(tmpdir(), "polyon-tool-continuation-"));
    let toolCalls = 0;

    try {
      const firstStores = new FileDomainStores(root);
      const first = createOrchestrator(
        firstStores,
        vi.fn(async () => {
          throw new Error("simulated process crash after tool checkpoint");
        }),
        vi.fn(async () => {
          toolCalls += 1;
          return { output: "tool result" };
        }),
      );

      const awaiting = await first.toolInvocation.invoke({
        invocationId: "tool-call:call-1",
        toolId: tool.id,
        input: { value: "hello" },
        action: "TERMINAL",
        riskLevel: "MEDIUM",
        policy,
        decisionId: "policy-decision:call-1",
        approvalRequestId: "approval:call-1",
        requestedBy: "actor.test",
        requestedAt: now,
        evaluatedAt: now,
        actorId: "actor.test",
        missionId: "mission.test",
        taskId: "task.test",
        executionId: "execution.test",
        agentId,
        toolContinuation: {
          agentId,
          requiredCapabilityIds: ["text.generate"],
          request: {
            messages: [{ role: "USER", content: "Use the tool." }],
          },
          response: {
            content: "",
            finishReason: "TOOL_CALL",
            toolCalls: [
              {
                id: "call-1",
                toolId: tool.id,
                input: { value: "hello" },
              },
            ],
          },
          toolCall: {
            id: "call-1",
            toolId: tool.id,
            input: { value: "hello" },
          },
          rounds: 1,
          state: "AWAITING_TOOL",
        },
      });

      expect(awaiting.status).toBe("APPROVAL_REQUIRED");

      first.toolInvocation.resolveApproval({
        approvalId: "approval:call-1",
        status: "APPROVED",
        resolvedAt: "2026-09-27T02:01:00.000Z",
        resolvedBy: "actor.test",
      });

      await expect(
        first.orchestrator.resumeApprovedExecution("execution.test", policy),
      ).rejects.toThrow("simulated process crash after tool checkpoint");

      expect(toolCalls).toBe(1);
      expect(firstStores.approvals.get("approval:call-1")?.toolContinuation).toMatchObject({
        state: "AWAITING_MODEL",
        toolOutput: "tool result",
        nextRequest: {
          messages: expect.arrayContaining([
            expect.objectContaining({
              role: "TOOL",
              toolCallId: "call-1",
              content: "tool result",
            }),
          ]),
        },
      });

      const secondStores = new FileDomainStores(root);
      const second = createOrchestrator(
        secondStores,
        vi.fn(async () => ({
          agentId,
          modelId: model.id,
          providerId: provider.id,
          source: "PREFERRED" as const,
          output: {
            content: "Recovered final answer.",
            finishReason: "STOP" as const,
          },
        })),
        vi.fn(async () => {
          toolCalls += 1;
          return { output: "tool result" };
        }),
      );

      const result = await second.orchestrator.resumeApprovedExecution("execution.test", policy);

      expect(result.status).toBe("SUCCEEDED");
      if (result.status === "SUCCEEDED") {
        expect(result.response.content).toBe("Recovered final answer.");
      }
      expect(toolCalls).toBe(1);
      expect(secondStores.approvals.get("approval:call-1")?.toolContinuation).toMatchObject({
        state: "COMPLETED",
        response: {
          content: "Recovered final answer.",
        },
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
