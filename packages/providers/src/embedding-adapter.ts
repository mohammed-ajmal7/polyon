import type { EmbeddingRequest, EmbeddingResponse, ModelId, ProviderId } from "@polyon/contracts";

export interface EmbeddingProviderAdapter {
  readonly providerId: ProviderId;
  embed(request: {
    readonly modelId: ModelId;
    readonly input: EmbeddingRequest;
    readonly signal?: AbortSignal;
  }): Promise<{ readonly output: EmbeddingResponse }>;
}

export interface EmbeddingAdapterRegistry {
  register(adapter: EmbeddingProviderAdapter): void;
  get(providerId: ProviderId): EmbeddingProviderAdapter | undefined;
  list(): readonly EmbeddingProviderAdapter[];
}

export class InMemoryEmbeddingAdapterRegistry implements EmbeddingAdapterRegistry {
  private readonly adapters = new Map<ProviderId, EmbeddingProviderAdapter>();

  register(adapter: EmbeddingProviderAdapter): void {
    if (this.adapters.has(adapter.providerId)) {
      throw new Error(`Embedding adapter already exists: ${adapter.providerId}.`);
    }
    this.adapters.set(adapter.providerId, adapter);
  }

  get(providerId: ProviderId): EmbeddingProviderAdapter | undefined {
    return this.adapters.get(providerId);
  }

  list(): readonly EmbeddingProviderAdapter[] {
    return [...this.adapters.values()];
  }
}
