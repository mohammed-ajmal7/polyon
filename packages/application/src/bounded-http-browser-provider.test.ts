import { describe, expect, it, vi } from "vitest";

import { BoundedHttpBrowserProvider } from "./bounded-http-browser-provider";

describe("BoundedHttpBrowserProvider", () => {
  it("fetches and bounds page content", async () => {
    const request = vi.fn(async () => ({
      url: "https://example.com/page",
      status: 200,
      statusText: "OK",
      headers: { "content-type": "text/html" },
      body: new TextEncoder().encode("abcdef"),
    }));

    const provider = new BoundedHttpBrowserProvider({ request } as never, {
      maxResponseBytes: 1024,
    });

    const result = await provider.fetch("https://example.com/page", {
      maxCharacters: 4,
    });

    expect(provider.kind).toBe("browser");
    expect(provider.id).toBe("bounded-http-browser");
    expect(result).toEqual({
      locator: "https://example.com/page",
      content: "abcd",
      contentType: "text/html",
      retrievedAt: expect.any(String),
    });
  });

  it("fails closed on non-success responses", async () => {
    const provider = new BoundedHttpBrowserProvider({
      request: vi.fn(async () => ({
        url: "https://example.com/page",
        status: 403,
        statusText: "Forbidden",
        headers: {},
        body: new Uint8Array(),
      })),
    } as never);

    await expect(provider.fetch("https://example.com/page")).rejects.toThrow(
      "Browser source returned HTTP 403.",
    );
  });
});
