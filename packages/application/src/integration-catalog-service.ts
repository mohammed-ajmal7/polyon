import type { ActionKind } from "@polyon/contracts";
import type {
  IntegrationAdapterRegistry,
  IntegrationId,
  IntegrationKind,
} from "@polyon/integrations";

export interface IntegrationCatalogEntry {
  readonly integrationId: IntegrationId;
  readonly kind: IntegrationKind;
  readonly actionKinds: readonly ActionKind[];
  readonly supportedOperations: readonly string[];
}

export interface IntegrationCatalogFilter {
  readonly kind?: IntegrationKind;
  readonly action?: ActionKind;
}

export type IntegrationCatalogServiceErrorKind = "INTEGRATION_NOT_FOUND";

export class IntegrationCatalogServiceError extends Error {
  readonly kind: IntegrationCatalogServiceErrorKind;

  constructor(kind: IntegrationCatalogServiceErrorKind, message: string) {
    super(message);
    this.name = "IntegrationCatalogServiceError";
    this.kind = kind;
  }
}

export class IntegrationCatalogService {
  constructor(private readonly registry: IntegrationAdapterRegistry) {}

  get(integrationId: IntegrationId): IntegrationCatalogEntry {
    const adapter = this.registry.get(integrationId);

    if (adapter === undefined) {
      throw new IntegrationCatalogServiceError(
        "INTEGRATION_NOT_FOUND",
        `Integration not found: ${integrationId}.`,
      );
    }

    return toEntry(adapter);
  }

  find(integrationId: IntegrationId): IntegrationCatalogEntry | undefined {
    const adapter = this.registry.get(integrationId);
    return adapter === undefined ? undefined : toEntry(adapter);
  }

  list(filter: IntegrationCatalogFilter = {}): readonly IntegrationCatalogEntry[] {
    return this.registry
      .list()
      .filter((adapter) => (filter.kind === undefined ? true : adapter.kind === filter.kind))
      .filter((adapter) =>
        filter.action === undefined ? true : adapter.actionKinds.includes(filter.action),
      )
      .map(toEntry)
      .sort((left, right) => left.integrationId.localeCompare(right.integrationId));
  }
}

function toEntry(adapter: {
  readonly integrationId: IntegrationId;
  readonly kind: IntegrationKind;
  readonly actionKinds: readonly ActionKind[];
  readonly supportedOperations: readonly string[];
}): IntegrationCatalogEntry {
  return {
    integrationId: adapter.integrationId,
    kind: adapter.kind,
    actionKinds: [...adapter.actionKinds],
    supportedOperations: [...adapter.supportedOperations],
  };
}
