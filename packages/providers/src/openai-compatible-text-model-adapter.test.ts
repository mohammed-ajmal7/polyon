import { describe, expect, it } from "vitest";

import {
  OpenAICompatibleTextModelAdapter,
  ProviderInvocationError,
  type OpenAICompatibleFetch,
} from ".";
import type { TextModelRequest } from "@polyon/contracts";

function createFetch(response: {
  readonly ok: boolean;
  readonly status: number;
  readonly payload: unknown;
}): OpenAICompatibleFetch {
  return async () => ({
    ok: response.ok,
    status: response.status,
    async json() {
      return response.payload;
    },
  });
}

const request: TextModelRequest = {
  messages: [{ role: "USER", content: "Hello." }],
  temperature: 0.2,
  maxOutputTokens: 100,
};

describe("OpenAICompatibleTextModelAdapter", () => {
  it("sends reasoning_effort only when configured", async () => {
    const bodies: Record<string, unknown>[] = [];
    const fetchImpl: OpenAICompatibleFetch = async (_input, init) => {
      bodies.push(JSON.parse(init.body) as Record<string, unknown>);
      return {
        ok: true,
        status: 200,
        async json() {
          return { choices: [{ message: { content: "ok" }, finish_reason: "stop" }] };
        },
      };
    };
    const endpoint = "http://127.0.0.1:11434/v1/chat/completions";

    await new OpenAICompatibleTextModelAdapter({
      providerId: "local",
      endpoint,
      fetch: fetchImpl,
    }).invoke({ modelId: "model", input: request });
    await new OpenAICompatibleTextModelAdapter({
      providerId: "local",
      endpoint,
      fetch: fetchImpl,
      reasoningEffort: "none",
    }).invoke({ modelId: "model", input: request });

    expect(bodies[0]).not.toHaveProperty("reasoning_effort");
    expect(bodies[1]).toMatchObject({ reasoning_effort: "none" });
  });

  it("explains an answer lost to an exhausted reasoning budget", async () => {
    const adapter = new OpenAICompatibleTextModelAdapter({
      providerId: "local",
      endpoint: "http://127.0.0.1:11434/v1/chat/completions",
      fetch: createFetch({
        ok: true,
        status: 200,
        payload: {
          choices: [
            { message: { content: "", reasoning: "Let me think..." }, finish_reason: "length" },
          ],
        },
      }),
    });

    await expect(adapter.invoke({ modelId: "model", input: request })).rejects.toMatchObject({
      kind: "INVALID_REQUEST",
      message: expect.stringContaining("output budget on reasoning"),
    });
  });

  it("classifies network failures as retryable and keeps their cause", async () => {
    const adapter = new OpenAICompatibleTextModelAdapter({
      providerId: "local",
      endpoint: "http://127.0.0.1:11434/v1/chat/completions",
      fetch: async () => {
        const cause = Object.assign(new Error("Headers Timeout Error"), {
          code: "UND_ERR_HEADERS_TIMEOUT",
        });
        throw new TypeError("fetch failed", { cause });
      },
    });

    await expect(adapter.invoke({ modelId: "model", input: request })).rejects.toMatchObject({
      kind: "UNAVAILABLE",
      retryable: true,
      message: "Provider request failed: fetch failed (UND_ERR_HEADERS_TIMEOUT).",
    });
  });

  it("maps a successful chat response into the POLYON response contract", async () => {
    let receivedBody: Record<string, unknown> | undefined;
    const fetchImpl: OpenAICompatibleFetch = async (_input, init) => {
      receivedBody = JSON.parse(init.body) as Record<string, unknown>;

      return {
        ok: true,
        status: 200,
        async json() {
          return {
            choices: [
              {
                message: { content: "Hello from the model." },
                finish_reason: "stop",
              },
            ],
            usage: {
              prompt_tokens: 10,
              completion_tokens: 5,
              total_tokens: 15,
            },
          };
        },
      };
    };

    const adapter = new OpenAICompatibleTextModelAdapter({
      providerId: "local",
      endpoint: "http://127.0.0.1:11434/v1/chat/completions",
      apiKey: "secret",
      fetch: fetchImpl,
    });

    await expect(
      adapter.invoke({
        modelId: "model-1",
        input: request,
      }),
    ).resolves.toEqual({
      output: {
        content: "Hello from the model.",
        finishReason: "STOP",
        usage: {
          inputTokens: 10,
          outputTokens: 5,
          totalTokens: 15,
        },
      },
    });

    expect(receivedBody).toEqual({
      model: "model-1",
      messages: [{ role: "user", content: "Hello." }],
      temperature: 0.2,
      max_tokens: 100,
    });
  });

  it("maps provider tool calls into structured POLYON tool calls", async () => {
    const adapter = new OpenAICompatibleTextModelAdapter({
      providerId: "provider-1",
      endpoint: "https://example.test/v1/chat/completions",
      fetch: createFetch({
        ok: true,
        status: 200,
        payload: {
          choices: [
            {
              message: {
                content: null,
                tool_calls: [
                  {
                    id: "call-1",
                    function: {
                      name: "builtin.filesystem.read",
                      arguments: '{"path":"notes.txt","maxBytes":1024}',
                    },
                  },
                ],
              },
              finish_reason: "tool_calls",
            },
          ],
        },
      }),
    });

    const toolAwareRequest: TextModelRequest = {
      ...request,
      tools: [
        {
          toolId: "builtin.filesystem.read",
          name: "builtin_filesystem_read",
          description: "Reads a bounded file.",
        },
      ],
    };

    await expect(adapter.invoke({ modelId: "model-1", input: toolAwareRequest })).resolves.toEqual({
      output: {
        content: "",
        finishReason: "TOOL_CALL",
        toolCalls: [
          {
            id: "call-1",
            toolId: "builtin.filesystem.read",
            input: { path: "notes.txt", maxBytes: 1024 },
          },
        ],
      },
    });
  });

  it("classifies rate limiting as retryable", async () => {
    const adapter = new OpenAICompatibleTextModelAdapter({
      providerId: "provider-1",
      endpoint: "https://example.test/v1/chat/completions",
      fetch: createFetch({
        ok: false,
        status: 429,
        payload: { error: { message: "Too many requests." } },
      }),
    });

    await expect(adapter.invoke({ modelId: "model-1", input: request })).rejects.toEqual(
      new ProviderInvocationError(
        "RATE_LIMITED",
        "provider-1",
        "model-1",
        "Too many requests.",
        true,
      ),
    );
  });

  it("classifies authentication failures as non-retryable", async () => {
    const adapter = new OpenAICompatibleTextModelAdapter({
      providerId: "provider-1",
      endpoint: "https://example.test/v1/chat/completions",
      fetch: createFetch({
        ok: false,
        status: 401,
        payload: { error: { message: "Invalid API key." } },
      }),
    });

    await expect(adapter.invoke({ modelId: "model-1", input: request })).rejects.toEqual(
      new ProviderInvocationError(
        "AUTHENTICATION",
        "provider-1",
        "model-1",
        "Invalid API key.",
        false,
      ),
    );
  });

  it("classifies server failures as retryable unavailable errors", async () => {
    const adapter = new OpenAICompatibleTextModelAdapter({
      providerId: "provider-1",
      endpoint: "https://example.test/v1/chat/completions",
      fetch: createFetch({
        ok: false,
        status: 503,
        payload: { error: { message: "Service unavailable." } },
      }),
    });

    await expect(adapter.invoke({ modelId: "model-1", input: request })).rejects.toEqual(
      new ProviderInvocationError(
        "UNAVAILABLE",
        "provider-1",
        "model-1",
        "Service unavailable.",
        true,
      ),
    );
  });

  it("fails closed on malformed successful responses", async () => {
    const adapter = new OpenAICompatibleTextModelAdapter({
      providerId: "provider-1",
      endpoint: "https://example.test/v1/chat/completions",
      fetch: createFetch({
        ok: true,
        status: 200,
        payload: { choices: [] },
      }),
    });

    await expect(adapter.invoke({ modelId: "model-1", input: request })).rejects.toEqual(
      new ProviderInvocationError(
        "UNKNOWN",
        "provider-1",
        "model-1",
        "Provider response did not contain a text message or tool calls.",
        false,
      ),
    );
  });
});
