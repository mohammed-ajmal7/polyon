import { describe, expect, it, vi } from "vitest";

import { InMemoryDomainStores } from "@polyon/storage";

import { ResearchService, type ResearchRetriever } from "./research-service";

describe("ResearchService", () => {
  it("persists sources and evidence atomically with trace events", async () => {
    const stores = new InMemoryDomainStores();
    const retriever: ResearchRetriever = {
      search: vi.fn(async () => [
        {
          title: "Example source",
          locator: "https://example.com/source",
          kind: "WEB",
          content: "A bounded source excerpt.",
          claim: "The source supports the claim.",
          retrievedAt: "2026-09-28T00:00:00.000Z",
        },
      ]),
    };
    const service = new ResearchService(
      retriever,
      stores.sources,
      stores.evidence,
      stores.events,
      stores,
    );

    const result = await service.conduct({
      query: "bounded research",
      actorId: "actor-1",
      sourceIdFactory: () => "source-1",
      evidenceIdFactory: () => "evidence-1",
      now: "2026-09-28T00:00:01.000Z",
    });

    expect(result.sources).toHaveLength(1);
    expect(result.evidence).toHaveLength(1);
    expect(stores.sources.get("source-1")).toEqual(result.sources[0]);
    expect(stores.evidence.get("evidence-1")).toEqual(result.evidence[0]);
    expect(stores.events.get("SOURCE_RETRIEVED:source-1")).toBeDefined();
    expect(stores.events.get("EVIDENCE_CAPTURED:evidence-1")).toBeDefined();
  });

  it("propagates caller cancellation and rejects invalid sources", async () => {
    const stores = new InMemoryDomainStores();
    const signal = new AbortController().signal;
    const retriever: ResearchRetriever = {
      search: vi.fn(async () => {
        expect(signal.aborted).toBe(false);
        return [];
      }),
    };
    const service = new ResearchService(retriever, stores.sources, stores.evidence, stores.events);

    await expect(
      service.conduct({
        query: "test",
        sourceLimit: 0,
        sourceIdFactory: () => "source",
        evidenceIdFactory: () => "evidence",
        now: "2026-09-28T00:00:00.000Z",
      }),
    ).rejects.toThrow("between 1 and 20");

    const invalidRetriever: ResearchRetriever = {
      search: vi.fn(async () => [
        {
          title: "",
          locator: "https://example.com",
          kind: "WEB",
          content: "content",
          retrievedAt: "2026-09-28T00:00:00.000Z",
        },
      ]),
    };
    const invalidService = new ResearchService(
      invalidRetriever,
      stores.sources,
      stores.evidence,
      stores.events,
    );

    await expect(
      invalidService.conduct({
        query: "test",
        sourceIdFactory: () => "source",
        evidenceIdFactory: () => "evidence",
        now: "2026-09-28T00:00:00.000Z",
      }),
    ).rejects.toThrow("title must not be empty");

    expect(stores.sources.list()).toHaveLength(0);
  });
});
