import { describe, expect, it } from "vitest";

import {
  ResearchFabric,
  ResearchFabricError,
  type AcademicProvider,
  type BrowserProvider,
  type CrawlerProvider,
  type PublicDataProvider,
  type SearchProvider,
} from "./research-fabric";

describe("ResearchFabric", () => {
  it("keeps research provider classes independently addressable", () => {
    const fabric = new ResearchFabric();
    const search: SearchProvider = {
      kind: "search",
      id: "search",
      async search() {
        return [];
      },
    };
    const browser: BrowserProvider = {
      kind: "browser",
      id: "browser",
      async fetch(locator) {
        return { locator, content: "page", retrievedAt: "2026-09-29T00:00:00.000Z" };
      },
    };
    const crawler: CrawlerProvider = {
      kind: "crawler",
      id: "crawler",
      async crawl() {
        return { pages: [] };
      },
    };
    const publicData: PublicDataProvider = {
      kind: "public-data",
      id: "public-data",
      async query(dataset) {
        return { dataset, records: [], retrievedAt: "2026-09-29T00:00:00.000Z" };
      },
    };
    const academic: AcademicProvider = {
      kind: "academic",
      id: "academic",
      async search() {
        return [];
      },
    };

    fabric.register(search);
    fabric.register(browser);
    fabric.register(crawler);
    fabric.register(publicData);
    fabric.register(academic);

    expect(fabric.searchProvider("search")).toBe(search);
    expect(fabric.browserProvider("browser")).toBe(browser);
    expect(fabric.crawlerProvider("crawler")).toBe(crawler);
    expect(fabric.publicDataProvider("public-data")).toBe(publicData);
    expect(fabric.academicProvider("academic")).toBe(academic);
  });

  it("rejects duplicate providers in the same capability namespace", () => {
    const fabric = new ResearchFabric();
    const first: SearchProvider = { kind: "search", id: "search", async search() { return []; } };
    const second: SearchProvider = { kind: "search", id: "search", async search() { return []; } };

    fabric.register(first);

    expect(() => fabric.register(second)).toThrowError(
      new ResearchFabricError(
        "PROVIDER_ALREADY_REGISTERED",
        "Research fabric provider is already registered: search.",
      ),
    );
  });
});
