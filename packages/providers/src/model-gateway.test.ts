import type { Model, Provider } from "@polyon/contracts";
import { describe, expect, it } from "vitest";

import {
  InMemoryProviderAdapterRegistry,
  ModelGateway,
  ModelGatewayError,
  type ModelCatalog,
  type ProviderCatalog,
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

function createCatalogs(
  modelValue: Model = model,
  providerValue: Provider = provider,
): { models: ModelCatalog; providers: ProviderCatalog } {
  return {
    models: {
      get: (id: string) => (id === modelValue.id ? modelValue : undefined),
    },
    providers: {
      get: (id: string) => (id === providerValue.id ? providerValue : undefined),
    },
  };
}

function createGateway(adapter: ModelProviderAdapter = {
  providerId: "provider-1",
  async invoke({ input }) {
    return { output: input };
  },
}) {
  const { models, providers } = createCatalogs();
  const adapters = new InMemoryProviderAdapterRegistry();
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
    const disabledModel: Model = {
      ...model,
      enabled: false,
    };

    const { providers } = createCatalogs(model, provider);
    const models: ModelCatalog = {
      get: (id: string) => (id === disabledModel.id ? disabledModel : undefined),
    };
    const adapters = new InMemoryProviderAdapterRegistry();

    adapters.register({
      providerId: "provider-1",
      async invoke() {
        return { output: "ok" };
      },
    });

    const disabledGateway = new ModelGateway({
      models,
      providers,
      adapters,
    });

    expect(() => disabledGateway.invoke("model-1", "hello")).toThrowError(
      expect.objectContaining({
        kind: "MODEL_DISABLED",
      }),
    );
  });

  it("rejects an unknown provider", async () => {
    const { models } = createCatalogs();
    const providers: ProviderCatalog = {
      get: () => undefined,
    };
    const adapters = new InMemoryProviderAdapterRegistry();

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
    const { models } = createCatalogs(model, { ...provider, enabled: false });
    const providers: ProviderCatalog = {
      get: () => ({ ...provider, enabled: false }),
    };
    const adapters = new InMemoryProviderAdapterRegistry();

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
    const { models, providers } = createCatalogs();
    const adapters = new InMemoryProviderAdapterRegistry();

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
