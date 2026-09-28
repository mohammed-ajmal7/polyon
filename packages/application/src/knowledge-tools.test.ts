import { describe, expect, it, vi } from "vitest";

import { InMemoryDomainStores } from "@polyon/storage";
import { InMemoryToolAdapterRegistry, InMemoryToolRegistry } from "@polyon/tools";

import { MemoryService } from "./memory-service";
import { ResearchService, type ResearchRetriever } from "./research-service";
import { registerKnowledgeTools } from "./knowledge-tools";

describe("knowledge tool adapters", () => {
  it("registers bounded memory search as a READ tool", async () => {
    const stores = new InMemoryDomainStores();
    const memory = new MemoryService(stores.memory, stores.events);
    memory.remember({
      id: "m1",
      kind: "FACT",
      scope: "PRIVATE",
      text: "POLYON uses explicit approval.",
      now: "2026-09-28T00:00:00.000Z",
    });

    const tools = new InMemoryToolRegistry();
    const adapters = new InMemoryToolAdapterRegistry();
    registerKnowledgeTools(tools, adapters, memory);

    const adapter = adapters.get("memory.search.scoped");
    const result = await adapter?.invoke({
      input: { query: "approval", scope: "PRIVATE" },
    });

    expect(tools.get("memory.search.scoped")?.actionKinds).toEqual(["READ"]);
    expect(result?.output).toEqual({
      items: [expect.objectContaining({ id: "m1" })],
    });
  });

  it("registers bounded research as a NETWORK tool and persists results", async () => {
    const stores = new InMemoryDomainStores();
    const retriever: ResearchRetriever = {
      search: vi.fn(async () => [
        {
          title: "Source",
          locator: "https://example.com/source",
          kind: "WEB" as const,
          content: "Evidence content",
          retrievedAt: "2026-09-28T00:00:00.000Z",
        },
      ]),
    };
    const research = new ResearchService(retriever, stores.sources, stores.evidence, stores.events);
    const tools = new InMemoryToolRegistry();
    const adapters = new InMemoryToolAdapterRegistry();
    registerKnowledgeTools(
      tools,
      adapters,
      new MemoryService(stores.memory, stores.events),
      research,
    );

    const adapter = adapters.get("research.search.bounded");
    const result = await adapter?.invoke({ input: { query: "query", sourceLimit: 1 } });

    expect(tools.get("research.search.bounded")?.actionKinds).toEqual(["NETWORK"]);
    expect(result?.output).toMatchObject({
      sources: [{ title: "Source" }],
      evidence: [{ claim: "query" }],
    });
    expect(stores.sources.list()).toHaveLength(1);
    expect(stores.evidence.list()).toHaveLength(1);
  });
  it("registers durable memory writes as a governed WRITE tool", async () => {
    const stores = new InMemoryDomainStores();
    const memory = new MemoryService(stores.memory, stores.events);
    const tools = new InMemoryToolRegistry();
    const adapters = new InMemoryToolAdapterRegistry();
    registerKnowledgeTools(tools, adapters, memory);

    const adapter = adapters.get("memory.remember");
    const result = await adapter?.invoke({
      input: {
        id: "memory-write-1",
        kind: "DECISION",
        scope: "PROJECT",
        text: "Use bounded execution.",
        tags: ["decision"],
      },
    });

    expect(tools.get("memory.remember")?.actionKinds).toEqual(["WRITE"]);
    expect(result?.output).toMatchObject({
      id: "memory-write-1",
      kind: "DECISION",
    });
    expect(stores.memory.get("memory-write-1")).toBeDefined();
  });
});
