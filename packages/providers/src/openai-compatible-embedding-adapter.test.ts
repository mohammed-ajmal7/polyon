import { describe, expect, it } from "vitest";

import { OpenAICompatibleEmbeddingAdapter } from "./openai-compatible-embedding-adapter";

describe("OpenAICompatibleEmbeddingAdapter", () => {
  it("parses bounded embedding responses without exposing credentials", async () => {
    const adapter = new OpenAICompatibleEmbeddingAdapter({
      providerId: "provider-1",
      endpoint: "https://embeddings.example.test/v1/embeddings",
      apiKey: "secret-token",
      fetch: async (_input, init) => {
        expect(init.headers.authorization).toBe("Bearer secret-token");
        const body = JSON.parse(init.body) as { model: string; input: string[] };
        expect(body).toEqual({ model: "embed-1", input: ["hello", "world"] });
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: [{ embedding: [1, 0] }, { embedding: [0, 1] }],
          }),
        };
      },
    });

    await expect(
      adapter.embed({ modelId: "embed-1", input: { input: ["hello", "world"] } }),
    ).resolves.toEqual({
      output: {
        vectors: [
          [1, 0],
          [0, 1],
        ],
      },
    });
  });

  it("rejects malformed vectors", async () => {
    const adapter = new OpenAICompatibleEmbeddingAdapter({
      providerId: "provider-1",
      endpoint: "https://embeddings.example.test/v1/embeddings",
      fetch: async () => ({
        ok: true,
        status: 200,
        json: async () => ({ data: [{ embedding: [1, Number.NaN] }] }),
      }),
    });

    await expect(
      adapter.embed({ modelId: "embed-1", input: { input: ["hello"] } }),
    ).rejects.toThrow("Embedding vector is invalid or exceeds bounds.");
  });
});
