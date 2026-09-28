import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { getPolyonComposition } from "./polyon-server";

const originalEnvironment = { ...process.env };

function restoreEnvironment(): void {
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnvironment)) delete process.env[key];
  }

  for (const [key, value] of Object.entries(originalEnvironment)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

function resetComposition(): void {
  const state = globalThis as typeof globalThis & { __polyonComposition?: unknown };
  state.__polyonComposition = undefined;
}

afterEach(() => {
  resetComposition();
  restoreEnvironment();
});

describe("POLYON server configuration smoke", () => {
  it("boots the real composition from a representative model-fleet configuration", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "polyon-server-config-smoke-"));
    const secret = "smoke-secret-that-must-not-enter-domain-data";

    try {
      process.env.POLYON_DATA_DIR = dataDir;
      process.env.POLYON_RUNTIME_AUTOSTART = "false";
      process.env.POLYON_SEMANTIC_INDEXING_AUTOSTART = "false";
      process.env.POLYON_MODEL_API_KEY = secret;
      process.env.POLYON_MODEL_PROFILES_JSON = JSON.stringify([
        {
          agentId: "researcher",
          agentName: "Researcher",
          agentRole: "Research specialist",
          modelId: "research-model",
          modelName: "Research model",
          providerId: "shared-provider",
          providerName: "Shared provider",
          endpoint: "http://127.0.0.1:11434/v1/chat/completions",
          apiKeyEnv: "POLYON_MODEL_API_KEY",
          fallbackModelIds: ["analysis-model"],
        },
        {
          agentId: "analyst",
          agentName: "Analyst",
          agentRole: "Analytical specialist",
          modelId: "analysis-model",
          modelName: "Analysis model",
          providerId: "shared-provider",
          providerName: "Shared provider",
          endpoint: "http://127.0.0.1:11434/v1/chat/completions",
          apiKeyEnv: "POLYON_MODEL_API_KEY",
        },
      ]);

      const composition = getPolyonComposition();
      const agents = composition.agents.list();
      const models = composition.models.list();
      const providers = composition.providers.list();

      expect(agents.map((agent) => agent.id)).toEqual(["researcher", "analyst"]);
      expect(agents[0]?.fallbackModelIds).toEqual(["analysis-model"]);
      expect(models.map((model) => model.id)).toEqual(["research-model", "analysis-model"]);
      expect(new Set(models.map((model) => model.providerId))).toEqual(new Set(["shared-provider"]));
      expect(providers.map((provider) => provider.id)).toEqual(["shared-provider"]);

      const command = composition.commandIngress.submit({
        mode: "Collaborative",
        command: "Smoke-test the server composition without calling an external model.",
        actorId: "smoke-user",
        conversationId: "conversation.config-smoke",
        messageId: "message.config-smoke",
        eventId: "event.config-smoke",
        participantIds: ["smoke-user", "researcher", "analyst"],
        createdAt: "2026-09-28T22:00:00.000Z",
      });

      expect(
        composition.stores.conversations.get(command.conversation.id)?.messageIds,
      ).toEqual([command.message.id]);
      expect(JSON.stringify(agents)).not.toContain(secret);
      expect(JSON.stringify(models)).not.toContain(secret);
      expect(JSON.stringify(providers)).not.toContain(secret);
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });
});
