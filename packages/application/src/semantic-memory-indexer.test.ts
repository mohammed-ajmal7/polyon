import { afterEach, describe, expect, it, vi } from "vitest";

import { JobService } from "@polyon/runtime";
import { InMemoryDomainStores } from "@polyon/storage";

import { createSemanticMemoryIndexer } from "./semantic-memory-indexer";

describe("createSemanticMemoryIndexer", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("runs an immediate bounded cycle on start and schedules future cycles", async () => {
    const reindex = vi.fn(async () => ({ indexed: 2, removed: 1, stale: 0, skipped: 3 }));
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
    expect(indexer.health.removedCount).toBe(1);
    expect(indexer.health.lastCycleResult).toEqual({
      indexed: 2,
      removed: 1,
      stale: 0,
      skipped: 3,
    });

    indexer.stop();
    expect(indexer.health.running).toBe(false);
  });

  it("does not start duplicate loops and captures provider failures without crashing the worker", async () => {
    const onError = vi.fn();
    const reindex = vi
      .fn()
      .mockRejectedValueOnce(new Error("embedding unavailable"))
      .mockResolvedValue({ indexed: 0, removed: 0, stale: 0, skipped: 1 });

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
      return { indexed: 1, removed: 0, stale: 0, skipped: 0 };
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
  it("persists exactly one restart-safe semantic indexing schedule", () => {
    const stores = new InMemoryDomainStores();
    const jobs = new JobService({ jobs: stores.jobs, events: stores.events, unitOfWork: stores });
    const indexer = createSemanticMemoryIndexer({ reindex: vi.fn() } as never, "embedding-model", {
      intervalMs: 1_000,
      jobBridge: jobs,
      jobUserId: "local-user",
    });

    indexer.start();
    indexer.start();

    const scheduled = jobs.list().filter((job) => job.kind === "scheduled");
    expect(scheduled).toHaveLength(1);
    expect(scheduled[0]).toMatchObject({
      id: "semantic-memory-index:local-user:1",
      userId: "local-user",
      status: "queued",
      payload: {
        scheduler: "semantic-memory-index",
        cycle: 1,
        modelId: "embedding-model",
        batchSize: 16,
        maxEntries: 100,
        allowedScopes: [],
      },
    });
    expect(indexer.health.scheduledJobId).toBe("semantic-memory-index:local-user:1");

    indexer.stop();
    expect(jobs.get("semantic-memory-index:local-user:1")?.status).toBe("cancelled");
  });

  it("runs a durable indexing job and schedules the next cycle", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-29T08:00:00.000Z"));

    const stores = new InMemoryDomainStores();
    const jobs = new JobService({ jobs: stores.jobs, events: stores.events, unitOfWork: stores });
    const reindex = vi.fn(async () => ({ indexed: 4, removed: 1, stale: 2, skipped: 3 }));
    const indexer = createSemanticMemoryIndexer({ reindex } as never, "embedding-model", {
      intervalMs: 1_000,
      jobBridge: jobs,
      jobUserId: "local-user",
    });

    indexer.start();
    const first = jobs.get("semantic-memory-index:local-user:1")!;
    const started = jobs.start(first.id, "2026-09-29T08:00:00.000Z");

    const result = await indexer.runDurableJob({
      job: started,
      signal: new AbortController().signal,
      now: "2026-09-29T08:00:00.000Z",
    });

    expect(result).toEqual({ indexed: 4, removed: 1, stale: 2, skipped: 3 });
    expect(reindex).toHaveBeenCalledOnce();
    expect(jobs.get("semantic-memory-index:local-user:2")).toMatchObject({
      kind: "scheduled",
      status: "queued",
      runAt: "2026-09-29T08:00:01.000Z",
    });

    indexer.stop();
  });

  it("keeps the schedule alive when the final retry attempt fails", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-29T08:00:00.000Z"));

    const stores = new InMemoryDomainStores();
    const jobs = new JobService({ jobs: stores.jobs, events: stores.events, unitOfWork: stores });
    const reindex = vi.fn(async () => {
      throw new Error("embedding unavailable");
    });
    const indexer = createSemanticMemoryIndexer({ reindex } as never, "embedding-model", {
      intervalMs: 1_000,
      jobBridge: jobs,
      jobUserId: "local-user",
      jobMaxAttempts: 1,
    });

    indexer.start();
    const first = jobs.get("semantic-memory-index:local-user:1")!;
    const started = jobs.start(first.id, "2026-09-29T08:00:00.000Z");

    await expect(
      indexer.runDurableJob({
        job: started,
        signal: new AbortController().signal,
        now: "2026-09-29T08:00:00.000Z",
      }),
    ).rejects.toThrow("embedding unavailable");

    expect(jobs.get("semantic-memory-index:local-user:2")).toMatchObject({
      kind: "scheduled",
      status: "queued",
      runAt: "2026-09-29T08:00:01.000Z",
    });
    indexer.stop();
  });
});
