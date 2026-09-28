import { describe, expect, it } from "vitest";

import { InMemoryDomainStores } from "@polyon/storage";

import { KnowledgeContextService } from "./knowledge-context-service";

describe("KnowledgeContextService", () => {
  it("assembles bounded context with explicit scope and provenance", () => {
    const stores = new InMemoryDomainStores();
    stores.sources.save({
      id: "source-1",
      kind: "WEB",
      title: "Source One",
      locator: "https://example.com/one",
    });
    stores.memory.save({
      id: "private-1",
      kind: "FACT",
      scope: "PRIVATE",
      text: "Private deployment uses a local model.",
      tags: ["deployment"],
      createdAt: "2026-09-28T00:00:00.000Z",
      updatedAt: "2026-09-28T00:00:01.000Z",
    });
    stores.memory.save({
      id: "project-1",
      kind: "FACT",
      scope: "PROJECT",
      text: "POLYON uses explicit approval gates.",
      tags: ["approval"],
      sourceIds: ["source-1"],
      createdAt: "2026-09-28T00:00:00.000Z",
      updatedAt: "2026-09-28T00:00:02.000Z",
    });
    stores.evidence.save({
      id: "evidence-1",
      sourceId: "source-1",
      kind: "SUPPORTING",
      claim: "Approval gates are explicit.",
      supportingContent: "The project requires policy and approval before consequential execution.",
      capturedAt: "2026-09-28T00:00:03.000Z",
    });

    const result = new KnowledgeContextService(
      stores.memory,
      stores.evidence,
      stores.sources,
    ).assemble({
      query: "approval",
      allowedScopes: ["PROJECT"],
      maxCharacters: 1_000,
    });

    expect(result.text).toContain("project-1");
    expect(result.text).toContain("evidence-1");
    expect(result.text).not.toContain("private-1");
    expect(result.sources).toEqual([expect.objectContaining({ id: "source-1" })]);
  });

  it("fails when the caller does not explicitly authorize a scope", () => {
    const stores = new InMemoryDomainStores();
    expect(() =>
      new KnowledgeContextService(stores.memory, stores.evidence, stores.sources).assemble({
        query: "anything",
        allowedScopes: [],
      }),
    ).toThrow("at least one allowed memory scope");
  });

  it("enforces context size bounds", () => {
    const stores = new InMemoryDomainStores();
    expect(() =>
      new KnowledgeContextService(stores.memory, stores.evidence, stores.sources).assemble({
        query: "anything",
        allowedScopes: ["PRIVATE"],
        maxCharacters: 100_001,
      }),
    ).toThrow("maxCharacters");
  });
});
