import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type {
  Agent,
  Conversation,
  Mission,
  Model,
  Policy,
  Provider,
  Task,
} from "@polyon/contracts";
import { BUILTIN_TOOL_IDS } from "@polyon/tools";
import { describe, expect, it, vi } from "vitest";

import { createPolyonComposition, type PolyonProviderRegistration } from "./polyon-composition";

const now = "2026-09-27T12:00:00.000Z";

function registration(): PolyonProviderRegistration {
  const provider: Provider = {
    id: "provider.test",
    name: "Test provider",
    kind: "HOSTED_MODEL",
    enabled: true,
  };
  const adapter: PolyonProviderRegistration["adapter"] = {
    providerId: provider.id,
    async invoke() {
      return { output: { content: "composition works" } };
    },
  };
  return { provider, adapter };
}

const model: Model = {
  id: "model.test",
  name: "Test model",
  kind: "TEXT",
  providerId: "provider.test",
  capabilityIds: ["text.generate"],
  enabled: true,
};

const agent: Agent = {
  id: "agent.test",
  name: "Test agent",
  role: "Execution agent",
  description: "Executes a test mission.",
  status: "ACTIVE",
  capabilityIds: ["text.generate"],
  preferredModelId: model.id,
  fallbackModelIds: [],
  createdAt: now,
  updatedAt: now,
};

const mission: Mission = {
  id: "mission.test",
  objective: "Execute a test mission.",
  constraints: [],
  status: "RUNNING",
  taskIds: ["task.test"],
  createdAt: now,
  updatedAt: now,
};

const policy: Policy = {
  id: "policy.test",
  name: "Test execution policy",
  description: "Allows the governed test execution.",
  approvalMode: "BALANCED",
  rules: [],
  defaultEffect: "ALLOW",
  enabled: true,
  createdAt: now,
  updatedAt: now,
};

const conversation: Conversation = {
  id: "conversation.test",
  kind: "MISSION",
  status: "ACTIVE",
  participantIds: ["actor.test", agent.id],
  messageIds: [],
  missionId: mission.id,
  createdAt: now,
  updatedAt: now,
};

const task: Task = {
  id: "task.test",
  missionId: mission.id,
  kind: "OTHER",
  title: "Test task",
  description: "Return the test result.",
  status: "PENDING",
  dependsOn: [],
  createdAt: now,
  updatedAt: now,
};

const identities = {
  executionId: (taskId: string, attempt: number) => `execution:${taskId}:${attempt}`,
  policyDecisionId: (taskId: string, executionId: string) => `policy:${taskId}:${executionId}`,
  approvalRequestId: (taskId: string, executionId: string) => `approval:${taskId}:${executionId}`,
};

describe("createPolyonComposition", () => {
  it("boots durable storage and executes a governed model-backed mission", async () => {
    const root = mkdtempSync(join(tmpdir(), "polyon-composition-"));

    try {
      const workspace = join(root, "workspace");
      const fileRoot = workspace;
      mkdirSync(fileRoot, { recursive: true });
      const composition = createPolyonComposition({
        storageRoot: root,
        filesystemRoot: fileRoot,
        artifactRoot: fileRoot,
        providers: [registration()],
        models: [model],
        agents: [agent],
      });

      expect(composition.stores.rootDir).toBe(root);
      expect(composition.agents.get(agent.id)?.id).toBe(agent.id);
      expect(composition.models.get(model.id)?.providerId).toBe("provider.test");
      expect(composition.providers.get("provider.test")?.enabled).toBe(true);
      expect(composition.runtime.status).toBe("STOPPED");
      expect(composition.toolInvocation).toBeDefined();
      expect(composition.artifactCatalog).toBeDefined();
      expect(composition.localArtifactContent).toBeDefined();
      expect(composition.tools.get(BUILTIN_TOOL_IDS.artifactList)).toMatchObject({
        kind: "ARTIFACT",
        actionKinds: ["READ"],
      });
      expect(composition.tools.get(BUILTIN_TOOL_IDS.artifactRead)).toMatchObject({
        kind: "ARTIFACT",
        actionKinds: ["READ"],
      });

      const toolFile = join(fileRoot, "mission.txt");
      writeFileSync(toolFile, "governed composition tool", "utf8");

      const toolResult = await composition.toolInvocation.invoke({
        invocationId: "invocation:composition:filesystem-read",
        toolId: BUILTIN_TOOL_IDS.filesystemRead,
        input: { path: "mission.txt", maxBytes: 1024 },
        action: "READ",
        riskLevel: "LOW",
        policy,
        decisionId: "decision:composition:filesystem-read",
        approvalRequestId: "approval:composition:filesystem-read",
        requestedBy: "actor.test",
        requestedAt: now,
        evaluatedAt: now,
        actorId: "actor.test",
        missionId: mission.id,
        taskId: task.id,
        executionId: "execution:tool:composition",
        agentId: agent.id,
      });

      expect(toolResult).toMatchObject({
        status: "SUCCEEDED",
        output: {
          content: "governed composition tool",
        },
      });

      composition.stores.tasks.save(task);
      composition.stores.conversations.save(conversation);

      const dispatched = composition.missionExecution.dispatchReadyTasks({
        mission,
        tasks: [task],
        actorId: "actor.test",
        agentId: agent.id,
        requiredCapabilityIds: ["text.generate"],
        policy,
        requestedBy: "actor.test",
        now,
        riskLevel: "LOW",
        identities,
      });

      expect(dispatched.awaitingApproval).toEqual([]);
      expect(dispatched.rejected).toEqual([]);
      expect(dispatched.dispatched).toHaveLength(1);
      expect(dispatched.dispatched[0]?.execution.status).toBe("QUEUED");
      expect(dispatched.dispatched[0]?.execution.agentId).toBe(agent.id);
      expect(dispatched.dispatched[0]?.execution.modelId).toBe(model.id);
      expect(dispatched.dispatched[0]?.execution.providerId).toBe("provider.test");

      composition.runtime.start();
      await vi.waitFor(() => {
        expect(composition.stores.executions.get("execution:task.test:1")?.status).toBe(
          "SUCCEEDED",
        );
      });

      expect(composition.stores.tasks.get(task.id)?.status).toBe("SUCCEEDED");
      expect(
        composition.stores.messages.get("execution-result:execution:task.test:1")?.content,
      ).toBe("composition works");
      expect(composition.stores.conversations.get(conversation.id)?.messageIds).toEqual([
        "execution-result:execution:task.test:1",
      ]);
      expect(
        composition.stores.events
          .listByExecution("execution:task.test:1")
          .map((event) => event.kind),
      ).toContain("MESSAGE_CREATED");
      expect(
        composition.stores.events
          .listByExecution("execution:task.test:1")
          .map((event) => event.kind),
      ).toContain("EXECUTION_ROUTED");
      expect(composition.runtime.queue.size()).toBe(0);
      composition.runtime.stop();

      const reopened = createPolyonComposition({
        storageRoot: root,
      });

      expect(reopened.stores.executions.get("execution:task.test:1")?.status).toBe("SUCCEEDED");
      expect(reopened.stores.messages.get("execution-result:execution:task.test:1")?.content).toBe(
        "composition works",
      );
      expect(reopened.stores.conversations.get(conversation.id)?.messageIds).toEqual([
        "execution-result:execution:task.test:1",
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("runs a model tool call through policy, the filesystem adapter, and back to the model", async () => {
    const root = mkdtempSync(join(tmpdir(), "polyon-tool-loop-"));

    try {
      const workspace = join(root, "workspace");
      mkdirSync(workspace, { recursive: true });
      writeFileSync(join(workspace, "notes.txt"), "tool loop content", "utf8");

      let calls = 0;
      const provider: Provider = {
        id: "provider.tool-loop",
        name: "Tool loop provider",
        kind: "HOSTED_MODEL",
        enabled: true,
      };
      const adapter: PolyonProviderRegistration["adapter"] = {
        providerId: provider.id,
        async invoke({ input }) {
          calls += 1;
          if (calls === 1) {
            return {
              output: {
                content: "",
                finishReason: "TOOL_CALL",
                toolCalls: [
                  {
                    id: "call-1",
                    toolId: BUILTIN_TOOL_IDS.filesystemRead,
                    input: { path: "notes.txt", maxBytes: 1024 },
                  },
                ],
              },
            };
          }

          const messages = (input as { messages: readonly { role: string; content: string }[] })
            .messages;
          expect(
            messages.some(
              (message) => message.role === "TOOL" && message.content.includes("tool loop content"),
            ),
          ).toBe(true);

          return {
            output: {
              content: "Final answer after reading the file.",
              finishReason: "STOP",
            },
          };
        },
      };

      const composition = createPolyonComposition({
        storageRoot: root,
        filesystemRoot: workspace,
        providers: [{ provider, adapter }],
        models: [{ ...model, id: "model.tool-loop", providerId: provider.id }],
        agents: [{ ...agent, id: "agent.tool-loop", preferredModelId: "model.tool-loop" }],
        toolPolicy: policy,
        maxToolRounds: 3,
      });

      const result = await composition.agentToolOrchestration.invoke({
        agentId: "agent.tool-loop",
        requiredCapabilityIds: ["text.generate"],
        request: {
          messages: [{ role: "USER", content: "Read notes.txt and answer." }],
        },
        policy,
        actorId: "actor.test",
        missionId: mission.id,
        taskId: task.id,
        executionId: "execution:tool-loop",
        now: () => now,
      });

      expect(result.status).toBe("SUCCEEDED");
      if (result.status === "SUCCEEDED") {
        expect(result.response.content).toBe("Final answer after reading the file.");
        expect(result.rounds).toBe(1);
      }
      expect(calls).toBe(2);
      expect(
        composition.stores.events.listByExecution("execution:tool-loop").map((event) => event.kind),
      ).toContain("TOOL_INVOKED");
      expect(
        composition.stores.events
          .listByExecution("execution:tool-loop")
          .filter((event) => event.kind === "TOOL_INVOKED")
          .map((event) => event.data),
      ).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ status: "SUCCEEDED", toolId: BUILTIN_TOOL_IDS.filesystemRead }),
        ]),
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
