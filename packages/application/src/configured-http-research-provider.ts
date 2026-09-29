import { BoundedHttpClient } from "@polyon/integrations";
import type { SourceKind } from "@polyon/contracts";

import type { SearchProvider, SearchResult } from "./research-fabric";

export type ResearchSearchProvider = SearchProvider;
export type ResearchSearchResult = SearchResult;

export interface ConfiguredHttpResearchProviderOptions {
  readonly endpoint: string;
  readonly http: BoundedHttpClient;
  readonly id?: string;
}

interface SearchPayload {
  readonly results: readonly ResearchSearchResult[];
}

export class ConfiguredHttpResearchProvider implements SearchProvider {
  readonly kind = "search" as const;
  readonly id: string;

  constructor(private readonly options: ConfiguredHttpResearchProviderOptions) {
    this.id = options.id?.trim() || "configured-http-search";
  }

  async search(
    query: string,
    options: { readonly limit: number; readonly signal?: AbortSignal },
  ): Promise<readonly ResearchSearchResult[]> {
    const response = await this.options.http.request(
      {
        url: this.options.endpoint,
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          query,
          limit: options.limit,
        }),
        signal: options.signal,
      },
      {
        maxRequestBytes: 16_384,
        maxResponseBytes: 256_000,
      },
    );

    if (response.status < 200 || response.status >= 300) {
      throw new Error(`Research search provider returned HTTP ${response.status}.`);
    }

    let payload: unknown;
    try {
      payload = JSON.parse(new TextDecoder().decode(response.body));
    } catch {
      throw new Error("Research search provider returned invalid JSON.");
    }

    if (!isRecord(payload) || !Array.isArray(payload.results)) {
      throw new Error("Research search provider returned an invalid result envelope.");
    }

    return payload.results.slice(0, options.limit).map(parseResult);
  }
}

function parseResult(value: unknown): ResearchSearchResult {
  if (!isRecord(value)) throw new Error("Research search result must be an object.");

  const title = stringField(value.title, "title", 1_000);
  const locator = stringField(value.locator, "locator", 2_000);
  const rawKind = value.kind;
  const kind = rawKind === undefined ? undefined : parseSourceKind(rawKind);

  return kind === undefined ? { title, locator } : { title, locator, kind };
}

function parseSourceKind(value: unknown): SourceKind {
  if (
    value === "WEB" ||
    value === "DOCUMENT" ||
    value === "DATABASE" ||
    value === "FILE" ||
    value === "MESSAGE" ||
    value === "API" ||
    value === "USER_PROVIDED" ||
    value === "AGENT_GENERATED" ||
    value === "OTHER"
  ) {
    return value;
  }
  throw new Error("Research source kind is invalid.");
}

function stringField(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Research search result ${field} must be a non-empty string.`);
  }
  if (Array.from(value).length > maxLength) {
    throw new Error(`Research search result ${field} exceeds its bound.`);
  }
  return value.trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
