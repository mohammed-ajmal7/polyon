import type { Provider } from "@polyon/contracts";
import { describe, expect, it } from "vitest";

import { InMemoryProviderRegistry, ProviderRegistryError } from "./provider-registry";

const provider: Provider = {
  id: "provider-1",
  name: "Local Provider",
  kind: "LOCAL_MODEL",
  enabled: true,
};

describe("InMemoryProviderRegistry", () => {
  it("registers and retrieves a provider", () => {
    const registry = new InMemoryProviderRegistry();

    registry.register(provider);

    expect(registry.get("provider-1")).toEqual(provider);
  });

  it("returns undefined for an unknown provider", () => {
    const registry = new InMemoryProviderRegistry();

    expect(registry.get("missing")).toBeUndefined();
  });

  it("rejects duplicate provider identifiers", () => {
    const registry = new InMemoryProviderRegistry();
    registry.register(provider);

    expect(() => registry.register(provider)).toThrowError(
      new ProviderRegistryError("PROVIDER_ALREADY_EXISTS", "provider-1"),
    );
  });

  it("lists providers deterministically", () => {
    const registry = new InMemoryProviderRegistry();
    registry.register(provider);
    registry.register({
      ...provider,
      id: "provider-2",
      name: "Hosted Provider",
      kind: "HOSTED_MODEL",
    });

    expect(registry.list().map((entry) => entry.id)).toEqual(["provider-1", "provider-2"]);
  });
});
