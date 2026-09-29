import { describe, expect, it, vi } from "vitest";

import { BoundedWebResearchRetriever } from "./bounded-web-research-retriever";

describe("BoundedWebResearchRetriever", () => {
  it("fetches only bounded, allowlisted search results", async () => {
    const search = vi.fn(async () => [
      { title: "A", locator: "https://example.com/a" },
      { title: "B", locator: "https://example.com/b" },
    ]);
    const request = vi
      .fn()
      .mockResolvedValueOnce({
        url: "https://example.com/a",
        status: 200,
        statusText: "OK",
        headers: { "content-type": "text/html" },
        body: new TextEncoder().encode("source A"),
      })
      .mockResolvedValueOnce({
        url: "https://example.com/b",
        status: 200,
        statusText: "OK",
        headers: {},
        body: new TextEncoder().encode("source B"),
      });

    const retriever = new BoundedWebResearchRetriever({ search }, { request } as never);

    const result = await retriever.search("query", { limit: 1 });

    expect(search).toHaveBeenCalledWith("query", { limit: 1 });
    expect(request).toHaveBeenCalledTimes(1);
    expect(result).toEqual([
      expect.objectContaining({
        title: "A",
        locator: "https://example.com/a",
        content: "source A",
        kind: "WEB",
      }),
    ]);
  });

  it("fails closed on non-success source responses", async () => {
    const retriever = new BoundedWebResearchRetriever(
      { search: vi.fn(async () => [{ title: "A", locator: "https://example.com/a" }]) },
      {
        request: vi.fn(async () => ({
          url: "https://example.com/a",
          status: 503,
          statusText: "Unavailable",
          headers: {},
          body: new Uint8Array(),
        })),
      } as never,
    );

    await expect(retriever.search("query", { limit: 1 })).rejects.toThrow(
      "Browser source returned HTTP 503.",
    );
  });

  it("skips a failing source and keeps the others", async () => {
    const retriever = new BoundedWebResearchRetriever(
      {
        search: vi.fn(async () => [
          { title: "Broken", locator: "https://example.com/broken" },
          { title: "Good", locator: "https://example.com/good" },
        ]),
      },
      {
        request: vi.fn(async (input: { url: string }) =>
          input.url.endsWith("/broken")
            ? {
                url: input.url,
                status: 503,
                statusText: "Down",
                headers: {},
                body: new Uint8Array(),
              }
            : {
                url: input.url,
                status: 200,
                statusText: "OK",
                headers: { "content-type": "text/plain" },
                body: new TextEncoder().encode("good content"),
              },
        ),
      } as never,
    );

    const result = await retriever.search("query", { limit: 2 });

    expect(result).toEqual([expect.objectContaining({ title: "Good", content: "good content" })]);
  });
});
