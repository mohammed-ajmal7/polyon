import { describe, expect, it, vi } from "vitest";

import { createSemanticMemoryIndexer } from "./semantic-memory-indexer";

describe("createSemanticMemoryIndexer", () => {
  it("runs an immediate bounded cycle on start and schedules future cycles", async () => {
    const reindex = vi.fn(async () => ({ indexed: 2, stale: 0, skipped: 3 }));
    const service = { reindex } as never;

    const indexer = createSemanticMemoryIndexer(service, "embedding-model", {
      intervalMs: 1_000,
      batchSize: 8,
      maxEntries: 25,
    });

    indexer.start();

    await vi.waitFor(() => {
      expect(reindex).toHaveBeenCalledWith(
        "embedding-model",
        expect.objectContaining({
          batchSize: 8,
          maxEntries: 25,
        }),
      );
    });

    expect(indexer.health.running).toBe(true);
    expect(indexer.health.indexedCount).toBe(2);

    indexer.stop();
    expect(indexer.health.running).toBe(false);
  });

  it("does not start duplicate loops and captures provider failures without crashing the worker", async () => {
    const onError = vi.fn();
    const reindex = vi
      .fn()
      .mockRejectedValueOnce(new Error("embedding unavailable"))
      .mockResolvedValue({ indexed: 0, stale: 0, skipped: 1 });

    const indexer = createSemanticMemoryIndexer({ reindex } as never, "embedding-model", {
      intervalMs: 1_000,
      onError,
    });

    indexer.start();
    indexer.start();

    await vi.waitFor(() => {
      expect(onError).toHaveBeenCalledOnce();
    });

    expect(indexer.health.consecutiveErrorCount).toBe(1);
    expect(indexer.health.lastError).toBe("embedding unavailable");

    indexer.stop();
  });

  it("rejects a manual run while the automatic cycle is active", async () => {
    let release: (() => void) | undefined;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const reindex = vi.fn(async () => {
      await pending;
      return { indexed: 1, stale: 0, skipped: 0 };
    });

    const indexer = createSemanticMemoryIndexer({ reindex } as never, "embedding-model", {
      intervalMs: 1_000,
    });

    indexer.start();

    await vi.waitFor(() => {
      expect(indexer.health.cycleActive).toBe(true);
    });

    await expect(indexer.runOnce()).rejects.toThrow("cycle is already active");

    release?.();
    await vi.waitFor(() => {
      expect(indexer.health.cycleActive).toBe(false);
    });
    indexer.stop();
  });

  it("rejects unsafe indexing configuration", () => {
    expect(() =>
      createSemanticMemoryIndexer({ reindex: vi.fn() } as never, " ", {
        intervalMs: 1_000,
      }),
    ).toThrow("model ID");

    expect(() =>
      createSemanticMemoryIndexer({ reindex: vi.fn() } as never, "model", {
        intervalMs: 999,
      }),
    ).toThrow("interval");

    expect(() =>
      createSemanticMemoryIndexer({ reindex: vi.fn() } as never, "model", {
        intervalMs: 3_600_001,
      }),
    ).toThrow("interval");
  });
});
