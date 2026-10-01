import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  getPolyonBaseUrl,
  getPolyonComposition,
  isUntrustedBrowserProtocolRequest,
} from "./polyon-server";

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
  it("marks the single configured model as tool-capable when requested", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "polyon-server-single-model-"));

    try {
      process.env.POLYON_DATA_DIR = dataDir;
      process.env.POLYON_RUNTIME_AUTOSTART = "false";
      process.env.POLYON_SEMANTIC_INDEXING_AUTOSTART = "false";
      delete process.env.POLYON_MODEL_PROFILES_JSON;
      process.env.POLYON_MODEL_ENDPOINT = "http://127.0.0.1:11434/v1/chat/completions";
      process.env.POLYON_MODEL_ID = "local-model";
      process.env.POLYON_MODEL_SUPPORTS_TOOLS = "true";

      const model = getPolyonComposition().models.get("local-model");

      expect(model?.supportsTools).toBe(true);
      expect(model?.capabilityIds).toContain("ai.tool-calling");
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

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
      expect(new Set(models.map((model) => model.providerId))).toEqual(
        new Set(["shared-provider"]),
      );
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

      expect(composition.stores.conversations.get(command.conversation.id)?.messageIds).toEqual([
        command.message.id,
      ]);
      expect(JSON.stringify(agents)).not.toContain(secret);
      expect(JSON.stringify(models)).not.toContain(secret);
      expect(JSON.stringify(providers)).not.toContain(secret);
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it("registers configured Drive and Telegram integrations without exposing their secrets", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "polyon-server-integrations-"));
    const driveToken = "drive-token-that-must-not-enter-domain-data";
    const telegramToken = "telegram-token-that-must-not-enter-domain-data";

    try {
      process.env.POLYON_DATA_DIR = dataDir;
      process.env.POLYON_RUNTIME_AUTOSTART = "false";
      process.env.POLYON_SEMANTIC_INDEXING_AUTOSTART = "false";
      process.env.POLYON_GOOGLE_DRIVE_ACCESS_TOKEN = driveToken;
      process.env.POLYON_TELEGRAM_BOT_TOKEN = telegramToken;

      const composition = getPolyonComposition();
      const integrations = composition.integrations.list();

      expect(integrations.map((integration) => integration.id)).toEqual([
        "google-drive-primary",
        "telegram-primary",
      ]);
      expect(JSON.stringify(integrations)).not.toContain(driveToken);
      expect(JSON.stringify(integrations)).not.toContain(telegramToken);
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it("only lets bearer clients or same-origin JSON browsers call protocol endpoints", () => {
    const request = (headers: Record<string, string>) =>
      new Request("http://localhost:3000/api/mcp", {
        method: "POST",
        headers: { host: "localhost:3000", ...headers },
      });

    expect(isUntrustedBrowserProtocolRequest(request({ authorization: "Bearer token" }))).toBe(
      false,
    );
    expect(
      isUntrustedBrowserProtocolRequest(
        request({ origin: "http://localhost:3000", "content-type": "application/json" }),
      ),
    ).toBe(false);
    expect(
      isUntrustedBrowserProtocolRequest(
        request({ origin: "http://localhost:5173", "content-type": "application/json" }),
      ),
    ).toBe(true);
    expect(
      isUntrustedBrowserProtocolRequest(
        request({ origin: "http://localhost:3000", "content-type": "text/plain" }),
      ),
    ).toBe(true);
  });

  it("advertises the public origin instead of the container bind address", () => {
    delete process.env.POLYON_PUBLIC_BASE_URL;
    const request = (headers: Record<string, string>) =>
      new Request("http://0.0.0.0:3000/.well-known/agent-card.json", { headers });

    expect(getPolyonBaseUrl(request({ host: "localhost:3000" }))).toBe("http://localhost:3000");
    expect(
      getPolyonBaseUrl(
        request({
          host: "0.0.0.0:3000",
          "x-forwarded-host": "polyon.example",
          "x-forwarded-proto": "https",
        }),
      ),
    ).toBe("https://polyon.example");
    expect(getPolyonBaseUrl(request({ host: "bad host/../x" }))).toBe("http://0.0.0.0:3000");
  });
});
