import { describe, expect, it } from "vitest";

import {
  InMemoryProviderAdapterRegistry,
  ProviderAdapterRegistryError,
} from "./provider-adapter-registry";

const adapter = {
  providerId: "provider-1",
  async invoke({ input }: { input: string }) {
    return { output: input.toUpperCase() };
  },
};

describe("InMemoryProviderAdapterRegistry", () => {
  it("registers and retrieves an adapter by provider", () => {
    const registry = new InMemoryProviderAdapterRegistry();

    registry.register(adapter);

    expect(registry.get("provider-1")).toBe(adapter);
  });

  it("returns undefined for an unknown provider", () => {
    const registry = new InMemoryProviderAdapterRegistry();

    expect(registry.get("missing")).toBeUndefined();
  });

  it("rejects duplicate provider adapters", () => {
    const registry = new InMemoryProviderAdapterRegistry();
    registry.register(adapter);

    expect(() => registry.register(adapter)).toThrowError(
      new ProviderAdapterRegistryError(
        "PROVIDER_ADAPTER_ALREADY_EXISTS",
        "provider-1",
      ),
    );
  });

  it("lists adapters deterministically", () => {
    const registry = new InMemoryProviderAdapterRegistry();
    const second = {
      ...adapter,
      providerId: "provider-2",
    };

    registry.register(adapter);
    registry.register(second);

    expect(registry.list().map((entry) => entry.providerId)).toEqual([
      "provider-1",
      "provider-2",
    ]);
  });
});
