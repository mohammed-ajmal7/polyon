import { describe, expect, it, vi } from "vitest";

import type { Model, Provider } from "@polyon/contracts";

import {
  EmbeddingGateway,
  EmbeddingGatewayError,
  InMemoryEmbeddingAdapterRegistry,
  UsageGovernor,
} from "./index";

describe("EmbeddingGateway", () => {
  const model: Model = {
    id: "embed-1",
    providerId: "provider-1",
    name: "Embedding model",
    kind: "EMBEDDING",
    capabilityIds: [],
    enabled: true,
  };
  const provider: Provider = {
    id: "provider-1",
    name: "Embedding provider",
    kind: "HOSTED_MODEL",
    enabled: true,
  };

  it("routes embedding models through a separate provider adapter registry", async () => {
    const adapters = new InMemoryEmbeddingAdapterRegistry();
    const embed = vi.fn(async () => ({
      output: {
        vectors: [
          [1, 0],
          [0, 1],
        ],
      },
    }));
    adapters.register({ providerId: "provider-1", embed });

    const gateway = new EmbeddingGateway({
      models: { get: (id) => (id === model.id ? model : undefined) },
      providers: { get: (id) => (id === provider.id ? provider : undefined) },
      adapters,
    });

    await expect(gateway.embed(model.id, { input: ["first", "second"] })).resolves.toEqual({
      vectors: [
        [1, 0],
        [0, 1],
      ],
    });
    expect(embed).toHaveBeenCalledTimes(1);
  });

  it("rejects non-embedding models and unbounded input", async () => {
    const adapters = new InMemoryEmbeddingAdapterRegistry();
    const gateway = new EmbeddingGateway({
      models: { get: () => ({ ...model, kind: "TEXT" }) },
      providers: { get: () => provider },
      adapters,
    });

    await expect(gateway.embed(model.id, { input: ["hello"] })).rejects.toMatchObject({
      kind: "MODEL_KIND_UNSUPPORTED",
    } satisfies Partial<EmbeddingGatewayError>);

    const validGateway = new EmbeddingGateway({
      models: { get: () => model },
      providers: { get: () => provider },
      adapters,
    });

    await expect(
      validGateway.embed(model.id, { input: Array.from({ length: 33 }, () => "x") }),
    ).rejects.toThrow("between 1 and 32");
  });

  it("applies zero-cost mode and request budgets to embedding calls", async () => {
    const adapters = new InMemoryEmbeddingAdapterRegistry();
    const embed = vi.fn(async () => ({ output: { vectors: [[1, 0]] } }));
    adapters.register({ providerId: "provider-1", embed });
    const catalog = {
      models: { get: (id: string) => (id === model.id ? model : undefined) },
      providers: { get: (id: string) => (id === provider.id ? provider : undefined) },
      adapters,
    };

    const zeroCost = new EmbeddingGateway({
      ...catalog,
      usageGovernor: new UsageGovernor({ costMode: "zero" }),
    });
    await expect(zeroCost.embed(model.id, { input: ["hello"] })).rejects.toMatchObject({
      kind: "PAID_MODEL_BLOCKED",
    });
    expect(embed).not.toHaveBeenCalled();

    const limited = new EmbeddingGateway({
      ...catalog,
      usageGovernor: new UsageGovernor({
        budgets: [{ providerId: "provider-1", dailyRequestLimit: 1 }],
      }),
    });
    await limited.embed(model.id, { input: ["hello"] });
    await expect(limited.embed(model.id, { input: ["again"] })).rejects.toMatchObject({
      kind: "DAILY_REQUEST_LIMIT",
    });
    expect(embed).toHaveBeenCalledTimes(1);
  });
});
