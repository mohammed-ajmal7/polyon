import type { IntegrationAdapter } from "./integration-adapter";
import { describe, expect, it } from "vitest";

import {
  InMemoryIntegrationAdapterRegistry,
  IntegrationAdapterRegistryError,
} from "./integration-adapter-registry";

const googleDrive: IntegrationAdapter = {
  integrationId: "drive-primary",
  kind: "GOOGLE_DRIVE",
  async invoke() {
    return { output: "ok" };
  },
};

const telegram: IntegrationAdapter = {
  integrationId: "telegram-primary",
  kind: "TELEGRAM",
  async invoke() {
    return { output: "ok" };
  },
};

describe("InMemoryIntegrationAdapterRegistry", () => {
  it("registers and retrieves an integration adapter", () => {
    const registry = new InMemoryIntegrationAdapterRegistry();

    registry.register(googleDrive);

    expect(registry.get("drive-primary")).toBe(googleDrive);
  });

  it("returns undefined for an unknown integration", () => {
    const registry = new InMemoryIntegrationAdapterRegistry();

    expect(registry.get("missing")).toBeUndefined();
  });

  it("rejects duplicate integration adapter identifiers", () => {
    const registry = new InMemoryIntegrationAdapterRegistry();
    registry.register(googleDrive);

    expect(() => registry.register(googleDrive)).toThrowError(
      new IntegrationAdapterRegistryError(
        "INTEGRATION_ADAPTER_ALREADY_EXISTS",
        "drive-primary",
      ),
    );
  });

  it("filters adapters by the supported integration kind", () => {
    const registry = new InMemoryIntegrationAdapterRegistry();
    registry.register(googleDrive);
    registry.register(telegram);

    expect(registry.listByKind("GOOGLE_DRIVE")).toEqual([googleDrive]);
    expect(registry.listByKind("EMAIL")).toEqual([]);
  });
});
