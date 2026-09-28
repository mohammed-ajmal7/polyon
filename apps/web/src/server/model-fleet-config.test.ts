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

  it("builds one model/provider registration while multiple agents share it", () => {
    const profiles = parseModelProfiles(
      JSON.stringify([
        {
          agentId: "researcher",
          agentName: "Researcher",
          modelId: "qwen3:8b",
          modelName: "Qwen 3 8B",
          providerId: "ollama",
          providerName: "Ollama",
          endpoint: "http://127.0.0.1:11434/v1/chat/completions",
        },
        {
          agentId: "analyst",
          agentName: "Analyst",
          modelId: "qwen3:8b",
          modelName: "Qwen 3 8B",
          providerId: "ollama",
          providerName: "Ollama",
          endpoint: "http://127.0.0.1:11434/v1/chat/completions",
        },
        {
          agentId: "fact-checker",
          agentName: "Fact Checker",
          modelId: "another-model",
          providerId: "cloud",
          providerName: "Cloud",
          endpoint: "https://example.com/v1/chat/completions",
        },
      ]),
    );

    const result = buildModelRegistrations(profiles, {});

    expect(result.agents.map((agent) => agent.id)).toEqual([
      "researcher",
      "analyst",
      "fact-checker",
    ]);
    expect(result.agents.map((agent) => agent.preferredModelId)).toEqual([
      "qwen3:8b",
      "qwen3:8b",
      "another-model",
    ]);
    expect(result.models.map((model) => model.id)).toEqual(["qwen3:8b", "another-model"]);
    expect(result.models.map((model) => model.providerId)).toEqual(["ollama", "cloud"]);
    expect(result.providers.map((registration) => registration.provider.id)).toEqual([
      "ollama",
      "cloud",
    ]);
    expect(result.providers.map((registration) => registration.adapter.providerId)).toEqual([
      "ollama",
      "cloud",
    ]);
  });

  it("rejects inconsistent shared model/provider configuration", () => {
    expect(() =>
      parseModelProfiles(
        JSON.stringify([
          {
            agentId: "researcher",
            modelId: "shared-model",
            modelName: "Shared Model",
            providerId: "ollama",
            endpoint: "http://127.0.0.1:11434/v1/chat/completions",
          },
          {
            agentId: "analyst",
            modelId: "shared-model",
            modelName: "Different Model Name",
            providerId: "ollama",
            endpoint: "http://127.0.0.1:11434/v1/chat/completions",
          },
        ]),
      ),
    ).toThrow("inconsistently");

    expect(() =>
      parseModelProfiles(
        JSON.stringify([
          {
            agentId: "researcher",
            modelId: "research-model",
            providerId: "ollama",
            endpoint: "http://127.0.0.1:11434/v1/chat/completions",
          },
          {
            agentId: "analyst",
            modelId: "analyst-model",
            providerId: "ollama",
            endpoint: "http://different.example/v1/chat/completions",
          },
        ]),
      ),
    ).toThrow("inconsistently");
  });
});
