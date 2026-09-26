import type { Provider, ProviderId } from "@polyon/contracts";

export type ProviderRegistryErrorKind = "PROVIDER_ALREADY_EXISTS";

export class ProviderRegistryError extends Error {
  readonly kind: ProviderRegistryErrorKind;
  readonly providerId: ProviderId;

  constructor(kind: ProviderRegistryErrorKind, providerId: ProviderId) {
    super(`Provider already exists in registry: ${providerId}.`);
    this.name = "ProviderRegistryError";
    this.kind = kind;
    this.providerId = providerId;
  }
}

export interface ProviderRegistry {
  register(provider: Provider): void;
  get(providerId: ProviderId): Provider | undefined;
  list(): readonly Provider[];
}

export class InMemoryProviderRegistry implements ProviderRegistry {
  private readonly providers = new Map<ProviderId, Provider>();

  register(provider: Provider): void {
    if (this.providers.has(provider.id)) {
      throw new ProviderRegistryError("PROVIDER_ALREADY_EXISTS", provider.id);
    }

    this.providers.set(provider.id, { ...provider });
  }

  get(providerId: ProviderId): Provider | undefined {
    const provider = this.providers.get(providerId);

    return provider === undefined ? undefined : { ...provider };
  }

  list(): readonly Provider[] {
    return [...this.providers.values()].map((provider) => ({ ...provider }));
  }
}
