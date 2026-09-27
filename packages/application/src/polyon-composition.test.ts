import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Agent, Execution, Model, Provider, Task } from "@polyon/contracts";
import { describe, expect, it } from "vitest";
import { createPolyonComposition, type PolyonProviderRegistration } from "./polyon-composition";

function registration(): PolyonProviderRegistration {
  const provider: Provider = { id: "provider.test", name: "Test provider", kind: "OPENAI_COMPATIBLE", enabled: true };
  const adapter: PolyonProviderRegistration["adapter"] = {
    providerId: provider.id,
    async invoke() {
      return { output: { content: "composition works" } };
    },
  };
  return { provider, adapter };
}

const model: Model = {
  id: "model.test", name: "Test model", kind: "TEXT", providerId: "provider.test",
  capabilityIds: ["text.generate"], enabled: true,
};

const agent: Agent = {
  id: "agent.test", name: "Test agent", status: "ACTIVE", capabilityIds: ["text.generate"],
  preferredModelId: model.id, fallbackModelIds: [],
};

describe("createPolyonComposition", () => {
  it("boots durable storage and executes a queued model-backed execution", async () => {
    const root = mkdtempSync(join(tmpdir(), "polyon-composition-"));
    try {
      const composition = createPolyonComposition({
        storageRoot: root, providers: [registration()], models: [model], agents: [agent],
      });
      const task: Task = {
        id: "task.test", missionId: "mission.test", kind: "OTHER", title: "Test task",
        description: "Return the test result.", status: "APPROVED", dependsOn: [],
        createdAt: "2026-09-27T12:00:00.000Z", updatedAt: "2026-09-27T12:00:00.000Z",
      };
      const execution: Execution = {
        id: "execution.test", missionId: task.missionId, taskId: task.id, attempt: 1,
        status: "QUEUED", actorId: "actor.test", agentId: agent.id, modelId: model.id,
        providerId: "provider.test", createdAt: task.createdAt, updatedAt: task.updatedAt,
      };
      composition.stores.tasks.save(task);
      composition.stores.executions.save(execution);
      expect(composition.runtime.status).toBe("STOPPED");
      composition.runtime.start();
      const outcome = await composition.runtime.runNext();
      expect(outcome?.execution.status).toBe("SUCCEEDED");
      expect(outcome?.result).toMatchObject({ status: "SUCCEEDED", output: "composition works" });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
