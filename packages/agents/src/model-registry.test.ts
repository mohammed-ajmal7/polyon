import type { Model } from "@polyon/contracts";
import { describe, expect, it } from "vitest";

import { InMemoryModelRegistry, ModelRegistryError } from "./model-registry";

const model: Model = {
  id: "model-1",
  providerId: "provider-1",
  name: "Primary Model",
  kind: "TEXT",
  capabilityIds: ["research", "analysis"],
  enabled: true,
};

describe("InMemoryModelRegistry", () => {
  it("registers and retrieves a model", () => {
    const registry = new InMemoryModelRegistry();

    registry.register(model);

    expect(registry.get("model-1")).toEqual(model);
  });

  it("returns undefined for an unknown model", () => {
    const registry = new InMemoryModelRegistry();

    expect(registry.get("missing")).toBeUndefined();
  });

  it("lists registered models", () => {
    const registry = new InMemoryModelRegistry();
    registry.register(model);
    registry.register({
      ...model,
      id: "model-2",
      name: "Secondary Model",
    });

    expect(registry.list().map((entry) => entry.id)).toEqual(["model-1", "model-2"]);
  });

  it("rejects duplicate model identifiers", () => {
    const registry = new InMemoryModelRegistry();
    registry.register(model);

    expect(() => registry.register(model)).toThrowError(
      new ModelRegistryError("MODEL_ALREADY_EXISTS", "model-1"),
    );
  });

  it("does not expose mutable model state", () => {
    const registry = new InMemoryModelRegistry();
    registry.register(model);

    const retrieved = registry.get("model-1")!;
    (retrieved.capabilityIds as string[]).push("coding");

    expect(registry.get("model-1")?.capabilityIds).toEqual(["research", "analysis"]);
  });
});
