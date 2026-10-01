import type { SourceKind } from "@polyon/contracts";
import { BoundedHttpClient, type BoundedHttpClientError } from "@polyon/integrations";

import { BoundedHttpBrowserProvider } from "./bounded-http-browser-provider";
import type { ResearchRetriever, ResearchSourceCandidate } from "./research-service";

export interface ResearchSearchResult {
  readonly title: string;
  readonly locator: string;
  readonly kind?: SourceKind;
}

export interface BoundedWebResearchRetrieverOptions {
  readonly maxContentBytes?: number;
}

export class BoundedWebResearchRetriever implements ResearchRetriever {
  private readonly maxContentBytes: number;

  constructor(
    private readonly searchProvider: {
      search(
        query: string,
        options: { readonly limit: number; readonly signal?: AbortSignal },
      ): Promise<readonly ResearchSearchResult[]>;
    },
    private readonly http: BoundedHttpClient,
    options: BoundedWebResearchRetrieverOptions = {},
  ) {
    this.maxContentBytes = options.maxContentBytes ?? 100_000;
    if (!Number.isInteger(this.maxContentBytes) || this.maxContentBytes <= 0) {
      throw new RangeError("maxContentBytes must be a positive integer.");
    }
  }

  async search(
    query: string,
    options: { readonly limit: number; readonly signal?: AbortSignal },
  ): Promise<readonly ResearchSourceCandidate[]> {
    const results = await this.searchProvider.search(query, options);
    const browser = new BoundedHttpBrowserProvider(this.http, {
      maxResponseBytes: this.maxContentBytes,
    });
    const candidates: ResearchSourceCandidate[] = [];
    const failures: unknown[] = [];

    for (const result of results.slice(0, options.limit)) {
      if (options.signal?.aborted) {
        throw new Error("Research retrieval was cancelled.");
      }

      let page: Awaited<ReturnType<BoundedHttpBrowserProvider["fetch"]>>;
      try {
        page = await browser.fetch(result.locator, {
          signal: options.signal,
          maxCharacters: this.maxContentBytes,
        });
      } catch (error) {
        // One unreachable or disallowed page must not discard the other sources.
        if (options.signal?.aborted) throw error;
        failures.push(error);
        continue;
      }

      candidates.push({
        title: result.title,
        locator: result.locator,
        kind: result.kind ?? "WEB",
        content: page.content,
        context: page.contentType === undefined ? undefined : `content-type: ${page.contentType}`,
        retrievedAt: page.retrievedAt,
      });
    }

    // Fail closed only when no source could be read at all.
    if (candidates.length === 0 && failures.length > 0) throw failures[0];

    return candidates;
  }
}
