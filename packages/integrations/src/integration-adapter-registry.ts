import type { IntegrationAdapter, IntegrationId, IntegrationKind } from "./integration-adapter";

export type IntegrationAdapterRegistryErrorKind = "INTEGRATION_ADAPTER_ALREADY_EXISTS";

export class IntegrationAdapterRegistryError extends Error {
  readonly kind: IntegrationAdapterRegistryErrorKind;
  readonly integrationId: IntegrationId;

  constructor(kind: IntegrationAdapterRegistryErrorKind, integrationId: IntegrationId) {
    super(`Integration adapter already exists in registry: ${integrationId}.`);
    this.name = "IntegrationAdapterRegistryError";
    this.kind = kind;
    this.integrationId = integrationId;
  }
}

export interface IntegrationAdapterRegistry {
  register(adapter: IntegrationAdapter): void;
  get(integrationId: IntegrationId): IntegrationAdapter | undefined;
  list(): readonly IntegrationAdapter[];
  listByKind(kind: IntegrationKind): readonly IntegrationAdapter[];
}

export class InMemoryIntegrationAdapterRegistry implements IntegrationAdapterRegistry {
  private readonly adapters = new Map<IntegrationId, IntegrationAdapter>();

  register(adapter: IntegrationAdapter): void {
    if (this.adapters.has(adapter.integrationId)) {
      throw new IntegrationAdapterRegistryError(
        "INTEGRATION_ADAPTER_ALREADY_EXISTS",
        adapter.integrationId,
      );
    }

    this.adapters.set(adapter.integrationId, adapter);
  }

  get(integrationId: IntegrationId): IntegrationAdapter | undefined {
    return this.adapters.get(integrationId);
  }

  list(): readonly IntegrationAdapter[] {
    return [...this.adapters.values()];
  }

  listByKind(kind: IntegrationKind): readonly IntegrationAdapter[] {
    return this.list().filter((adapter) => adapter.kind === kind);
  }
}
