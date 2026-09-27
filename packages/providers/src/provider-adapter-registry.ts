import type { ProviderId } from "@polyon/contracts";

import type { ModelProviderAdapter } from "./provider-adapter";

export type ProviderAdapterRegistryErrorKind = "PROVIDER_ADAPTER_ALREADY_EXISTS";

export class ProviderAdapterRegistryError extends Error {
  readonly kind: ProviderAdapterRegistryErrorKind;
  readonly providerId: ProviderId;

  constructor(kind: ProviderAdapterRegistryErrorKind, providerId: ProviderId) {
    super(`Provider adapter already exists in registry: ${providerId}.`);
    this.name = "ProviderAdapterRegistryError";
    this.kind = kind;
    this.providerId = providerId;
  }
}

export interface ProviderAdapterRegistry {
  register(adapter: ModelProviderAdapter): void;
  get(providerId: ProviderId): ModelProviderAdapter | undefined;
  list(): readonly ModelProviderAdapter[];
}

export class InMemoryProviderAdapterRegistry implements ProviderAdapterRegistry {
  private readonly adapters = new Map<ProviderId, ModelProviderAdapter>();

  register(adapter: ModelProviderAdapter): void {
    if (this.adapters.has(adapter.providerId)) {
      throw new ProviderAdapterRegistryError("PROVIDER_ADAPTER_ALREADY_EXISTS", adapter.providerId);
    }

    this.adapters.set(adapter.providerId, adapter);
  }

  get(providerId: ProviderId): ModelProviderAdapter | undefined {
    return this.adapters.get(providerId);
  }

  list(): readonly ModelProviderAdapter[] {
    return [...this.adapters.values()];
  }
}
