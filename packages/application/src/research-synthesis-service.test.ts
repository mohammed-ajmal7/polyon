import { describe, expect, it, vi } from "vitest";

import { InMemoryDomainStores } from "@polyon/storage";

import { ResearchSynthesisService } from "./research-synthesis-service";

describe("ResearchSynthesisService", () => {
  it("synthesizes bounded evidence and persists an attributable memory summary", async () => {
    const stores = new InMemoryDomainStores();
    stores.sources.save({
      id: "source-1",
      kind: "WEB",
      title: "Source 1",
      locator: "https://example.com/1",
    });
    stores.evidence.save({
      id: "evidence-1",
      sourceId: "source-1",
      kind: "SUPPORTING",
      claim: "A bounded claim.",
      supportingContent: "The evidence says this.",
      missionId: "mission-1",
      capturedAt: "2026-09-28T00:00:00.000Z",
    });

    const invokeText = vi.fn(async () => ({
      agentId: "researcher",
      modelId: "model-1",
      providerId: "provider-1",
      source: "preferred" as const,
      output: {
        content: "Finding [source-1]. Uncertainty remains.",
      },
    }));

    const service = new ResearchSynthesisService(
      { invokeText } as never,
      stores.sources,
      stores.evidence,
      stores.memory,
      stores.events,
      stores,
    );

    const result = await service.synthesize({
      query: "What is true?",
      agentId: "researcher",
      requiredCapabilityIds: [],
      memoryId: "research-summary-1",
      now: "2026-09-28T00:00:01.000Z",
    });

    const firstCall = invokeText.mock.calls[0] as unknown as [
      {
        request: { messages: Array<{ content?: unknown }> };
      },
    ];
    expect(firstCall[0].request.messages[1]?.content).toContain(
      "[evidence:evidence-1 source:source-1 Source 1 quality:",
    );
    expect(result.memory.kind).toBe("SUMMARY");
    expect(stores.memory.get("research-summary-1")).toEqual(result.memory);
    expect(stores.events.get("RESEARCH_SYNTHESIZED:research-summary-1")).toBeDefined();
  });
});
