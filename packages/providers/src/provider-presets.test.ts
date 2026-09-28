import { describe, expect, it } from "vitest";

import {
  createTextModelProviderAdapter,
  getBuiltInProviderPreset,
  resolveProviderApiKeyEnv,
  resolveProviderEndpoint,
  type OpenAICompatibleFetch,
} from ".";

describe("built-in provider presets", () => {
  it("defines Ollama as the local zero-cost default", () => {
    expect(getBuiltInProviderPreset("ollama")).toEqual({
      providerId: "ollama",
      providerName: "Ollama",
      kind: "LOCAL_MODEL",
      defaultEndpoint: "http://127.0.0.1:11434/v1/chat/completions",
      defaultApiKeyEnv: "OLLAMA_API_KEY",
      privacyClass: "local",
      costClass: "free",
    });
  });

  it("defines Gemini and OpenAI as hosted providers", () => {
    expect(getBuiltInProviderPreset("gemini")).toMatchObject({
      providerId: "gemini",
      kind: "HOSTED_MODEL",
      defaultApiKeyEnv: "GEMINI_API_KEY",
      privacyClass: "cloud",
    });
    expect(getBuiltInProviderPreset("openai")).toMatchObject({
      providerId: "openai",
      kind: "HOSTED_MODEL",
      defaultApiKeyEnv: "OPENAI_API_KEY",
      privacyClass: "cloud",
    });
  });

  it("keeps custom providers supported when an explicit endpoint is supplied", () => {
    expect(resolveProviderEndpoint("custom-provider", "https://example.test/chat")).toBe(
      "https://example.test/chat",
    );
    expect(resolveProviderApiKeyEnv("custom-provider", "CUSTOM_API_KEY")).toBe("CUSTOM_API_KEY");
    expect(() => resolveProviderEndpoint("custom-provider")).toThrow(
      "Provider endpoint is required",
    );
  });

  it("uses explicit endpoint and API-key environment overrides", () => {
    expect(
      resolveProviderEndpoint("openai", "https://proxy.example.test/v1/chat/completions"),
    ).toBe("https://proxy.example.test/v1/chat/completions");
    expect(resolveProviderApiKeyEnv("gemini", "GOOGLE_AI_KEY")).toBe("GOOGLE_AI_KEY");
  });

  it("creates a provider adapter without exposing provider secrets", async () => {
    let receivedInput = "";
    let receivedHeaders: Readonly<Record<string, string>> | undefined;

    const fetchImpl: OpenAICompatibleFetch = async (input, init) => {
      receivedInput = input;
      receivedHeaders = init.headers;

      return {
        ok: true,
        status: 200,
        async json() {
          return {
            choices: [
              {
                message: { content: "ok" },
                finish_reason: "stop",
              },
            ],
          };
        },
      };
    };

    const adapter = createTextModelProviderAdapter({
      providerId: "gemini",
      fetch: fetchImpl,
      apiKey: "secret-value",
    });

    await adapter.invoke({
      modelId: "gemini-test",
      input: { messages: [{ role: "USER", content: "hello" }] },
    });

    expect(receivedInput).toBe(
      "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
    );
    expect(receivedHeaders).toMatchObject({
      authorization: "Bearer secret-value",
      "content-type": "application/json",
    });
  });
});
