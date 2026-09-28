import { describe, expect, it } from "vitest";

import type { MemoryEntry } from "@polyon/contracts";
import { EmbeddingGateway, InMemoryEmbeddingAdapterRegistry } from "@polyon/providers";
import { InMemoryDomainStores } from "@polyon/storage";

import { SemanticMemoryService } from "./semantic-memory-service";
import { ExactNormalizedSemanticVectorIndex } from "./semantic-vector-index";

describe("SemanticMemoryService", () => {
  it("persists embeddings and ranks semantic matches deterministically", async () => {
    const stores = new InMemoryDomainStores();
    const adapterRegistry = new InMemoryEmbeddingAdapterRegistry();

    adapterRegistry.register({
      providerId: "embedding-provider",
      embed: async ({ input }) => ({
        output: {
          vectors: input.input.map((value) => {
            if (value.includes("database")) return [1, 0];
            if (value.includes("email")) return [0, 1];
            return [0.9, 0.1];
          }),
        },
      }),
    });

    const gateway = new EmbeddingGateway({
      models: {
        get: (id) =>
          id === "embedding-model"
            ? {
                id,
                providerId: "embedding-provider",
                name: "Test embedding",
                kind: "EMBEDDING",
                capabilityIds: [],
                enabled: true,
              }
            : undefined,
      },
      providers: {
        get: (id) =>
          id === "embedding-provider"
            ? {
                id,
                name: "Test provider",
                kind: "HOSTED_MODEL",
                enabled: true,
              }
            : undefined,
      },
      adapters: adapterRegistry,
    });

    const service = new SemanticMemoryService(
      stores.memory,
      stores.memoryEmbeddings,
      gateway,
      stores,
    );

    const databaseMemory: MemoryEntry = {
      id: "m1",
      kind: "FACT",
      scope: "PROJECT",
      text: "The database uses durable state.",
      tags: ["storage"],
      createdAt: "2026-09-28T00:00:00.000Z",
      updatedAt: "2026-09-28T00:00:00.000Z",
    };
    const emailMemory: MemoryEntry = {
      id: "m2",
      kind: "FACT",
      scope: "PRIVATE",
      text: "Email is an external communication capability.",
      tags: ["email"],
      createdAt: "2026-09-28T00:00:01.000Z",
      updatedAt: "2026-09-28T00:00:01.000Z",
    };

    stores.memory.save(databaseMemory);
    stores.memory.save(emailMemory);

    await service.index(databaseMemory, "embedding-model", "2026-09-28T00:01:00.000Z");
    await service.index(emailMemory, "embedding-model", "2026-09-28T00:01:00.000Z");

    const results = await service.search({
      query: "database durability",
      modelId: "embedding-model",
      limit: 10,
    });

    expect(results.map((result) => result.memory.id)).toEqual(["m1", "m2"]);
    expect(results[0]?.score).toBeGreaterThan(results[1]?.score ?? 0);
    expect(stores.memoryEmbeddings.list()).toHaveLength(2);
  });


  it("reindexes only missing or stale embeddings in bounded batches", async () => {
    const stores = new InMemoryDomainStores();
    const adapterRegistry = new InMemoryEmbeddingAdapterRegistry();
    let calls = 0;

    adapterRegistry.register({
      providerId: "embedding-provider",
      embed: async ({ input }) => {
        calls += 1;
        return {
          output: {
            vectors: input.input.map(() => [1, 0]),
          },
        };
      },
    });

    const gateway = new EmbeddingGateway({
      models: {
        get: () => ({
          id: "embedding-model",
          providerId: "embedding-provider",
          name: "Test embedding",
          kind: "EMBEDDING",
          capabilityIds: [],
          enabled: true,
        }),
      },
      providers: {
        get: () => ({
          id: "embedding-provider",
          name: "Test provider",
          kind: "HOSTED_MODEL",
          enabled: true,
        }),
      },
      adapters: adapterRegistry,
    });

    const service = new SemanticMemoryService(
      stores.memory,
      stores.memoryEmbeddings,
      gateway,
      stores,
    );

    for (let index = 0; index < 5; index += 1) {
      stores.memory.save({
        id: "memory-" + index,
        kind: "FACT",
        scope: "PROJECT",
        text: "memory " + index,
        tags: [],
        createdAt: "2026-09-28T00:00:00.000Z",
        updatedAt: "2026-09-28T00:00:00.000Z",
      });
    }

    const result = await service.reindex("embedding-model", {
      now: "2026-09-28T00:10:00.000Z",
      batchSize: 2,
      maxEntries: 5,
    });

    expect(result).toEqual({ indexed: 5, stale: 0, skipped: 0 });
    expect(calls).toBe(3);
    expect(stores.memoryEmbeddings.list()).toHaveLength(5);

    const second = await service.reindex("embedding-model", {
      now: "2026-09-28T00:11:00.000Z",
      batchSize: 2,
      maxEntries: 5,
    });

    expect(second).toEqual({ indexed: 0, stale: 0, skipped: 5 });
    expect(calls).toBe(3);
  });

  it("does not embed memory scopes outside the explicit indexing allowlist", async () => {
    const stores = new InMemoryDomainStores();
    const adapterRegistry = new InMemoryEmbeddingAdapterRegistry();
    const embeddedTexts: string[] = [];

    adapterRegistry.register({
      providerId: "embedding-provider",
      embed: async ({ input }) => {
        embeddedTexts.push(...input.input);
        return { output: { vectors: input.input.map(() => [1, 0]) } };
      },
    });

    const gateway = new EmbeddingGateway({
      models: {
        get: () => ({
          id: "embedding-model",
          providerId: "embedding-provider",
          name: "Test embedding",
          kind: "EMBEDDING",
          capabilityIds: [],
          enabled: true,
        }),
      },
      providers: {
        get: () => ({
          id: "embedding-provider",
          name: "Test provider",
          kind: "HOSTED_MODEL",
          enabled: true,
        }),
      },
      adapters: adapterRegistry,
    });

    const service = new SemanticMemoryService(
      stores.memory,
      stores.memoryEmbeddings,
      gateway,
      stores,
    );

    stores.memory.save({
      id: "private-memory",
      kind: "FACT",
      scope: "PRIVATE",
      text: "private secret context",
      tags: [],
      createdAt: "2026-09-28T00:00:00.000Z",
      updatedAt: "2026-09-28T00:00:00.000Z",
    });
    stores.memory.save({
      id: "project-memory",
      kind: "FACT",
      scope: "PROJECT",
      text: "project deployment context",
      tags: [],
      createdAt: "2026-09-28T00:00:00.000Z",
      updatedAt: "2026-09-28T00:00:00.000Z",
    });

    const result = await service.reindex("embedding-model", {
      now: "2026-09-28T00:10:00.000Z",
      allowedScopes: ["PROJECT"],
    });

    expect(result.indexed).toBe(1);
    expect(result.skipped).toBe(1);
    expect(embeddedTexts).toEqual(["project deployment context"]);
    expect(stores.memoryEmbeddings.get("missing") ?? undefined).toBeUndefined();
    expect(stores.memoryEmbeddings.list().map((entry) => entry.memoryId)).toEqual(["project-memory"]);
  });


  it("does not update the vector index when the durable transaction fails", async () => {
    const stores = new InMemoryDomainStores();
    const adapterRegistry = new InMemoryEmbeddingAdapterRegistry();
    adapterRegistry.register({
      providerId: "embedding-provider",
      embed: async () => ({ output: { vectors: [[1, 0]] } }),
    });

    const gateway = new EmbeddingGateway({
      models: {
        get: () => ({
          id: "embedding-model",
          providerId: "embedding-provider",
          name: "Test embedding",
          kind: "EMBEDDING",
          capabilityIds: [],
          enabled: true,
        }),
      },
      providers: {
        get: () => ({
          id: "embedding-provider",
          providerId: "embedding-provider",
          name: "Test provider",
          kind: "HOSTED_MODEL",
          enabled: true,
        }),
      },
      adapters: adapterRegistry,
    });

    const vectorIndex = new ExactNormalizedSemanticVectorIndex();
    const failingUnitOfWork = {
      transaction<T>(work: () => T): T {
        work();
        throw new Error("commit failed");
      },
    };

    const service = new SemanticMemoryService(
      stores.memory,
      stores.memoryEmbeddings,
      gateway,
      failingUnitOfWork as never,
      vectorIndex,
    );

    const memory = {
      id: "m-transaction-fail",
      kind: "FACT" as const,
      scope: "PROJECT" as const,
      text: "transactional memory",
      tags: [],
      createdAt: "2026-09-28T00:00:00.000Z",
      updatedAt: "2026-09-28T00:00:00.000Z",
    };
    stores.memory.save(memory);

    await expect(
      service.index(memory, "embedding-model", "2026-09-28T00:01:00.000Z"),
    ).rejects.toThrow("commit failed");

    expect(vectorIndex.search("embedding-model", [1, 0])).toEqual([]);
  });

  it("ignores stale embeddings after the source memory changes", async () => {
    const stores = new InMemoryDomainStores();
    const adapterRegistry = new InMemoryEmbeddingAdapterRegistry();
    adapterRegistry.register({
      providerId: "embedding-provider",
      embed: async () => ({ output: { vectors: [[1, 0]] } }),
    });

    const gateway = new EmbeddingGateway({
      models: {
        get: () => ({
          id: "embedding-model",
          providerId: "embedding-provider",
          name: "Test embedding",
          kind: "EMBEDDING",
          capabilityIds: [],
          enabled: true,
        }),
      },
      providers: {
        get: () => ({
          id: "embedding-provider",
          name: "Test provider",
          kind: "HOSTED_MODEL",
          enabled: true,
        }),
      },
      adapters: adapterRegistry,
    });

    const service = new SemanticMemoryService(stores.memory, stores.memoryEmbeddings, gateway, stores);
    const memory: MemoryEntry = {
      id: "m1",
      kind: "FACT",
      scope: "PROJECT",
      text: "Original text",
      tags: [],
      createdAt: "2026-09-28T00:00:00.000Z",
      updatedAt: "2026-09-28T00:00:00.000Z",
    };

    stores.memory.save(memory);
    await service.index(memory, "embedding-model", "2026-09-28T00:01:00.000Z");
    stores.memory.save({ ...memory, text: "Changed text", updatedAt: "2026-09-28T00:02:00.000Z" });

    await expect(
      service.search({ query: "anything", modelId: "embedding-model" }),
    ).resolves.toEqual([]);
  });
});
