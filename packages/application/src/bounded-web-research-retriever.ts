import type { SourceKind } from "@polyon/contracts";
import { BoundedHttpClient, type BoundedHttpClientError } from "@polyon/integrations";

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
    const candidates: ResearchSourceCandidate[] = [];

    for (const result of results.slice(0, options.limit)) {
      if (options.signal?.aborted) {
        throw new Error("Research retrieval was cancelled.");
      }

      const response = await this.http.request(
        {
          url: result.locator,
          method: "GET",
          signal: options.signal,
        },
        { maxResponseBytes: this.maxContentBytes },
      );

      if (response.status < 200 || response.status >= 300) {
        throw new Error(`Research source returned HTTP ${response.status}.`);
      }

      const contentType = response.headers["content-type"] ?? "";
      const content = new TextDecoder().decode(response.body);

      candidates.push({
        title: result.title,
        locator: result.locator,
        kind: result.kind ?? "WEB",
        content,
        context: contentType === "" ? undefined : `content-type: ${contentType}`,
        retrievedAt: new Date().toISOString(),
      });
    }

    return candidates;
  }
}
