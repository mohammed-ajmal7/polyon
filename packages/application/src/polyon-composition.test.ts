import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Agent, Mission, Model, Policy, Provider, Task } from "@polyon/contracts";
import { describe, expect, it, vi } from "vitest";

import {
  createPolyonComposition,
  type PolyonProviderRegistration,
} from "./polyon-composition";

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
  policyDecisionId: (taskId: string, executionId: string) =>
    `policy:${taskId}:${executionId}`,
  approvalRequestId: (taskId: string, executionId: string) =>
    `approval:${taskId}:${executionId}`,
};

describe("createPolyonComposition", () => {
  it("boots durable storage and executes a governed model-backed mission", async () => {
    const root = mkdtempSync(join(tmpdir(), "polyon-composition-"));

    try {
      const composition = createPolyonComposition({
        storageRoot: root,
        providers: [registration()],
        models: [model],
        agents: [agent],
      });

      expect(composition.stores.rootDir).toBe(root);
      expect(composition.agents.get(agent.id)?.id).toBe(agent.id);
      expect(composition.models.get(model.id)?.providerId).toBe("provider.test");
      expect(composition.providers.get("provider.test")?.enabled).toBe(true);
      expect(composition.runtime.status).toBe("STOPPED");

      composition.stores.tasks.save(task);

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
      expect(composition.stores.events.listByExecution("execution:task.test:1").map((event) => event.kind)).toContain(
        "EXECUTION_ROUTED",
      );
      expect(composition.runtime.queue.size()).toBe(0);
      composition.runtime.stop();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
