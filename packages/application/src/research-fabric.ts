import type { SourceKind } from "@polyon/contracts";

export interface SearchResult {
  readonly title: string;
  readonly locator: string;
  readonly kind?: SourceKind;
}

export interface SearchProvider {
  readonly kind: "search";
  readonly id: string;
  search(
    query: string,
    options: { readonly limit: number; readonly signal?: AbortSignal },
  ): Promise<readonly SearchResult[]>;
}

export interface BrowseResult {
  readonly title?: string;
  readonly locator: string;
  readonly content: string;
  readonly contentType?: string;
  readonly retrievedAt: string;
}

export interface BrowserProvider {
  readonly kind: "browser";
  readonly id: string;
  fetch(
    locator: string,
    options: { readonly signal?: AbortSignal; readonly maxCharacters?: number },
  ): Promise<BrowseResult>;
}

export interface CrawlResult {
  readonly pages: readonly BrowseResult[];
}

export interface CrawlerProvider {
  readonly kind: "crawler";
  readonly id: string;
  crawl(
    locator: string,
    options: {
      readonly signal?: AbortSignal;
      readonly maxPages: number;
      readonly maxCharactersPerPage?: number;
    },
  ): Promise<CrawlResult>;
}

export interface PublicDataResult {
  readonly dataset: string;
  readonly records: readonly Readonly<Record<string, unknown>>[];
  readonly retrievedAt: string;
}

export interface PublicDataProvider {
  readonly kind: "public-data";
  readonly id: string;
  query(
    dataset: string,
    parameters: Readonly<Record<string, string | number | boolean | null>>,
    options: { readonly signal?: AbortSignal; readonly limit: number },
  ): Promise<PublicDataResult>;
}

export interface AcademicSearchResult {
  readonly title: string;
  readonly locator: string;
  readonly abstract?: string;
  readonly publishedAt?: string;
}

export interface AcademicProvider {
  readonly kind: "academic";
  readonly id: string;
  search(
    query: string,
    options: { readonly signal?: AbortSignal; readonly limit: number },
  ): Promise<readonly AcademicSearchResult[]>;
}

export type ResearchFabricProvider =
  | SearchProvider
  | BrowserProvider
  | CrawlerProvider
  | PublicDataProvider
  | AcademicProvider;

export class ResearchFabric {
  private readonly searchProviders = new Map<string, SearchProvider>();
  private readonly browserProviders = new Map<string, BrowserProvider>();
  private readonly crawlerProviders = new Map<string, CrawlerProvider>();
  private readonly publicDataProviders = new Map<string, PublicDataProvider>();
  private readonly academicProviders = new Map<string, AcademicProvider>();

  register(provider: ResearchFabricProvider): void {
    switch (provider.kind) {
      case "search":
        registerProvider(this.searchProviders, provider);
        return;
      case "browser":
        registerProvider(this.browserProviders, provider);
        return;
      case "crawler":
        registerProvider(this.crawlerProviders, provider);
        return;
      case "public-data":
        registerProvider(this.publicDataProviders, provider);
        return;
      case "academic":
        registerProvider(this.academicProviders, provider);
        return;
    }
  }

  searchProvider(id: string): SearchProvider | undefined {
    return this.searchProviders.get(id);
  }

  browserProvider(id: string): BrowserProvider | undefined {
    return this.browserProviders.get(id);
  }

  crawlerProvider(id: string): CrawlerProvider | undefined {
    return this.crawlerProviders.get(id);
  }

  publicDataProvider(id: string): PublicDataProvider | undefined {
    return this.publicDataProviders.get(id);
  }

  academicProvider(id: string): AcademicProvider | undefined {
    return this.academicProviders.get(id);
  }

  listSearchProviders(): readonly SearchProvider[] {
    return [...this.searchProviders.values()];
  }

  listBrowserProviders(): readonly BrowserProvider[] {
    return [...this.browserProviders.values()];
  }

  listCrawlerProviders(): readonly CrawlerProvider[] {
    return [...this.crawlerProviders.values()];
  }

  listPublicDataProviders(): readonly PublicDataProvider[] {
    return [...this.publicDataProviders.values()];
  }

  listAcademicProviders(): readonly AcademicProvider[] {
    return [...this.academicProviders.values()];
  }



function registerProvider<T extends { readonly id: string }>(
  collection: Map<string, T>,
  provider: T,
): void {
  if (collection.has(provider.id)) {
    throw new ResearchFabricError(
      "PROVIDER_ALREADY_REGISTERED",
      `Research fabric provider is already registered: ${provider.id}.`,
    );
  }
  collection.set(provider.id, provider);
}

export type ResearchFabricErrorKind = "PROVIDER_ALREADY_REGISTERED";

export class ResearchFabricError extends Error {
  readonly kind: ResearchFabricErrorKind;

  constructor(kind: ResearchFabricErrorKind, message: string) {
    super(message);
    this.name = "ResearchFabricError";
    this.kind = kind;
  }
}



function isSearchProvider(provider: ResearchFabricProvider): provider is SearchProvider {
  return provider.kind === "search";
}

function isBrowserProvider(provider: ResearchFabricProvider): provider is BrowserProvider {
  return provider.kind === "browser";
}

function isCrawlerProvider(provider: ResearchFabricProvider): provider is CrawlerProvider {
  return provider.kind === "crawler";
}

function isPublicDataProvider(provider: ResearchFabricProvider): provider is PublicDataProvider {
  return provider.kind === "public-data";
}

