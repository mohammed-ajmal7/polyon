import { describe, expect, it, vi } from "vitest";

import { ConfiguredHttpResearchProvider } from "./configured-http-research-provider";

describe("ConfiguredHttpResearchProvider", () => {
  it("sends bounded search requests and validates provider results", async () => {
    const request = vi.fn(async () => ({
      url: "https://search.example.com",
      status: 200,
      statusText: "OK",
      headers: { "content-type": "application/json" },
      body: new TextEncoder().encode(
        JSON.stringify({
          results: [
            {
              title: "Result 1",
              locator: "https://example.com/1",
              kind: "WEB",
            },
          ],
        }),
      ),
    }));

    const provider = new ConfiguredHttpResearchProvider({
      endpoint: "https://search.example.com/api/search",
      http: { request } as never,
    });

    const result = await provider.search("hello", { limit: 3 });

    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ query: "hello", limit: 3 }),
      }),
      expect.objectContaining({
        maxRequestBytes: 16_384,
        maxResponseBytes: 256_000,
      }),
    );
    expect(result).toEqual([
      {
        title: "Result 1",
        locator: "https://example.com/1",
        kind: "WEB",
      },
    ]);
  });

  it("fails closed on malformed envelopes", async () => {
    const provider = new ConfiguredHttpResearchProvider({
      endpoint: "https://search.example.com/api/search",
      http: {
        request: vi.fn(async () => ({
          url: "https://search.example.com",
          status: 200,
          statusText: "OK",
          headers: {},
          body: new TextEncoder().encode("{}"),
        })),
      } as never,
    });

    await expect(provider.search("hello", { limit: 1 })).rejects.toThrow("invalid result envelope");
  });
});
