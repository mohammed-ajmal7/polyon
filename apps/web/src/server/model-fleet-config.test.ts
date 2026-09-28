import { describe, expect, it } from "vitest";

import { buildModelRegistrations, parseModelProfiles } from "./model-fleet-config";

describe("model fleet configuration", () => {
  it("parses a bounded multi-agent roster with explicit fallback models", () => {
    const profiles = parseModelProfiles(
      JSON.stringify([
        {
          agentId: "researcher",
          agentName: "Researcher",
          agentRole: "Research specialist",
          modelId: "research-model",
          modelName: "Research Model",
          providerId: "research-provider",
          providerName: "Research Provider",
          endpoint: "https://research.example/v1/chat/completions",
          apiKeyEnv: "RESEARCH_API_KEY",
          fallbackModelIds: ["fallback-model"],
        },
        {
          agentId: "fallback",
          agentName: "Fallback",
          agentRole: "Generalist",
          modelId: "fallback-model",
          providerId: "fallback-provider",
          endpoint: "http://127.0.0.1:11434/v1/chat/completions",
        },
      ]),
    );

    expect(profiles).toEqual([
      expect.objectContaining({
        agentId: "researcher",
        modelId: "research-model",
        providerId: "research-provider",
        fallbackModelIds: ["fallback-model"],
      }),
      expect.objectContaining({
        agentId: "fallback",
        modelId: "fallback-model",
      }),
    ]);
  });

  it("rejects duplicate identities and unknown fallbacks", () => {
    expect(() =>
      parseModelProfiles(
        JSON.stringify([
          {
            agentId: "researcher",
            modelId: "model-a",
            providerId: "provider-a",
            endpoint: "http://127.0.0.1:11434/v1/chat/completions",
          },
          {
            agentId: "researcher",
            modelId: "model-b",
            providerId: "provider-b",
            endpoint: "http://127.0.0.1:11434/v1/chat/completions",
          },
        ]),
      ),
    ).toThrow("Duplicate model profile agentId: researcher.");

    expect(() =>
      parseModelProfiles(
        JSON.stringify([
          {
            agentId: "researcher",
            modelId: "model-a",
            providerId: "provider-a",
            endpoint: "http://127.0.0.1:11434/v1/chat/completions",
            fallbackModelIds: ["missing-model"],
          },
        ]),
      ),
    ).toThrow("unknown fallback model");
  });

  it("builds one model and provider registration per configured agent", () => {
    const profiles = parseModelProfiles(
      JSON.stringify([
        {
          agentId: "researcher",
          modelId: "qwen3:8b",
          providerId: "ollama-research",
          endpoint: "http://127.0.0.1:11434/v1/chat/completions",
        },
        {
          agentId: "analyst",
          modelId: "another-model",
          providerId: "other-provider",
          endpoint: "https://example.com/v1/chat/completions",
        },
      ]),
    );

    const result = buildModelRegistrations(profiles, {
      RESEARCH_API_KEY: "not-used",
    });

    expect(result.agents.map((agent) => agent.id)).toEqual(["researcher", "analyst"]);
    expect(result.agents.map((agent) => agent.preferredModelId)).toEqual([
      "qwen3:8b",
      "another-model",
    ]);
    expect(result.models.map((model) => model.providerId)).toEqual([
      "ollama-research",
      "other-provider",
    ]);
    expect(result.providers.map((registration) => registration.provider.id)).toEqual([
      "ollama-research",
      "other-provider",
    ]);
    expect(result.providers.map((registration) => registration.adapter.providerId)).toEqual([
      "ollama-research",
      "other-provider",
    ]);
  });
});
