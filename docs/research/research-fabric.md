# POLYON research fabric

POLYON exposes provider-neutral research boundaries instead of coupling orchestration to one search implementation.

## Provider types

- `SearchProvider` discovers candidate sources.
- `BrowserProvider` fetches bounded source content.
- `CrawlerProvider` performs bounded multi-page collection.
- `PublicDataProvider` retrieves structured public datasets.
- `AcademicProvider` searches scholarly sources.

Each provider has an explicit capability kind and its own registry namespace. Provider IDs only need to be unique within their capability namespace.

## Current concrete adapters

`ConfiguredHttpResearchProvider` implements the search boundary using the existing bounded HTTP client.

`BoundedHttpBrowserProvider` implements bounded source fetching and is used by `BoundedWebResearchRetriever`.

The existing `ResearchService` remains the durable evidence persistence boundary. The fabric does not create a second research database or duplicate source/evidence stores.

## Security boundary

Research providers are expected to run behind bounded network clients and allowlists. External page content is data, not trusted instructions. Research output is persisted as source/evidence records before downstream synthesis.

## Extension path

Future provider implementations can add crawl, public-data, or academic functionality without changing the application orchestration contracts. This keeps provider-specific SDKs and endpoint details outside the core domain.
