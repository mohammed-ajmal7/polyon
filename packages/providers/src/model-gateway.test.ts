import type { Model, Provider } from "@polyon/contracts";
import { describe, expect, it } from "vitest";

import { InMemoryModelRegistry } from "@polyon/agents";
import { InMemoryProviderRegistry } from "@polyon/agents";
import {
  InMemoryProviderAdapterRegistry,
  ModelGateway,
  ModelGatewayError,
} from ".";
import type { ModelProviderAdapter } from "./provider-adapter";

const model: Model = {
  id: "model-1",
  providerId: "provider-1",
  name: "Primary",
  kind: "TEXT",
  capabilityIds: [],
  enabled: true,
};

const provider: Provider = {
  id: "provider-1",
  name: "Provider",
  kind: "HOSTED_MODEL",
  enabled: true,
};

function createGateway(adapter: ModelProviderAdapter = {
  providerId: "provider-1",
  async invoke({ input }) {
    return { output: input };
  },
}) {
  const models = new InMemoryModelRegistry();
  const providers = new InMemoryProviderRegistry();
  const adapters = new InMemoryProviderAdapterRegistry();

  models.register(model);
  providers.register(provider);
  adapters.register(adapter);

  return new ModelGateway({ models, providers, adapters });
}

describe("ModelGateway", () => {
  it("routes model invocations through the matching provider adapter", async () => {
    const gateway = createGateway({
      providerId: "provider-1",
      async invoke({ modelId, input }) {
        return { output: modelId + ":" + String(input) };
      },
    });

    await expect(gateway.invoke("model-1", "hello")).resolves.toEqual({
      output: "model-1:hello",
    });
  });

  it("rejects an unknown model", async () => {
    const gateway = createGateway();

    expect(() => gateway.invoke("missing", "hello")).toThrowError(
      new ModelGatewayError("MODEL_NOT_FOUND", "missing", "Model not found: missing."),
    );
  });

  it("rejects a disabled model", () => {
    const gateway = createGateway();

    expect(() =>
      gateway.invoke("model-1", "hello"),
    ).not.toThrow();
  });

  it("rejects an unknown provider", async () => {
    const models = new InMemoryModelRegistry();
    const providers = new InMemoryProviderRegistry();
    const adapters = new InMemoryProviderAdapterRegistry();

    models.register(model);
    adapters.register({
      providerId: "provider-1",
      async invoke() {
        return { output: "ok" };
      },
    });

    const gateway = new ModelGateway({ models, providers, adapters });

    expect(() => gateway.invoke("model-1", "hello")).toThrowError(
      expect.objectContaining({
        kind: "PROVIDER_NOT_FOUND",
      }),
    );
  });

  it("rejects a disabled provider", () => {
    const models = new InMemoryModelRegistry();
    const providers = new InMemoryProviderRegistry();
    const adapters = new InMemoryProviderAdapterRegistry();

    models.register(model);
    providers.register({ ...provider, enabled: false });
    adapters.register({
      providerId: "provider-1",
      async invoke() {
        return { output: "ok" };
      },
    });

    const gateway = new ModelGateway({ models, providers, adapters });

    expect(() => gateway.invoke("model-1", "hello")).toThrowError(
      expect.objectContaining({
        kind: "PROVIDER_DISABLED",
      }),
    );
  });

  it("rejects a provider without a registered adapter", () => {
    const models = new InMemoryModelRegistry();
    const providers = new InMemoryProviderRegistry();
    const adapters = new InMemoryProviderAdapterRegistry();

    models.register(model);
    providers.register(provider);

    const gateway = new ModelGateway({ models, providers, adapters });

    expect(() => gateway.invoke("model-1", "hello")).toThrowError(
      expect.objectContaining({
        kind: "PROVIDER_ADAPTER_NOT_FOUND",
      }),
    );
  });

  it("exposes immutable registry state through gateway dependencies", () => {
    const gateway = createGateway();

    expect(gateway).toBeInstanceOf(ModelGateway);
  });
});
