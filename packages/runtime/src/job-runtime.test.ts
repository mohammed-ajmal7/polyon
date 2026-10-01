import { describe, expect, it, vi } from "vitest";

import { InMemoryDomainStores } from "@polyon/storage";

import { JobService } from "./job-service";
import { createJobRuntime } from "./job-runtime";

const baseTime = "2026-09-29T08:00:00.000Z";

function createClock() {
  let value = baseTime;

  return {
    now: () => value,
    set(next: string): void {
      value = next;
    },
  };
}

function createRuntime(
  stores = new InMemoryDomainStores(),
  options: Partial<Parameters<typeof createJobRuntime>[0]> = {},
) {
  const jobs = new JobService({
    jobs: stores.jobs,
    events: stores.events,
    unitOfWork: stores,
  });

  const clock = createClock();
  const runtime = createJobRuntime({
    jobs,
    clock,
    pollIntervalMs: 60_000,
    wait: async () => new Promise<void>(() => undefined),
    ...options,
  });

  return { stores, jobs, clock, runtime };
}

function createQueuedJob(jobs: JobService, id = "job-1", runAt = baseTime, maxAttempts = 2): void {
  jobs.create({
    id,
    userId: "user-1",
    kind: "research",
    payload: { query: "POLYON" },
    runAt,
    maxAttempts,
    createdAt: baseTime,
  });
}

describe("createJobRuntime", () => {
  it("runs a due job through its registered handler", async () => {
    const { jobs, runtime } = createRuntime(undefined, {
      handlers: {
        research: async ({ job }) => ({ jobId: job.id, attempt: job.attempt }),
      },
    });
    createQueuedJob(jobs);

    runtime.start();

    for (let index = 0; index < 5 && jobs.get("job-1")?.status !== "completed"; index += 1) {
      await Promise.resolve();
    }

    expect(jobs.get("job-1")?.status).toBe("completed");
    expect(jobs.get("job-1")?.result).toEqual({ jobId: "job-1", attempt: 1 });

    runtime.stop();
  });

  it("does not run a future job before runAt", async () => {
    const { jobs, runtime, clock } = createRuntime(undefined, {
      handlers: {
        research: async () => ({ ok: true }),
      },
    });
    createQueuedJob(jobs, "future-job", "2026-09-29T09:00:00.000Z");

    runtime.start();
    await Promise.resolve();

    expect(jobs.get("future-job")?.status).toBe("queued");

    clock.set("2026-09-29T09:00:00.000Z");
    const completed = await runtime.runNext();

    expect(completed?.status).toBe("completed");
    runtime.stop();
  });

  it("retries failed handlers after bounded exponential backoff", async () => {
    let calls = 0;
    const handler = async () => {
      calls += 1;
      if (calls === 1) throw new Error("temporary");
      return { ok: true };
    };

    const controlled = createRuntime(undefined, {
      handlers: { research: handler },
      retryBackoffInitialMs: 1_000,
      retryBackoffMaxMs: 1_000,
    });
    createQueuedJob(controlled.jobs);
    controlled.runtime.start();

    for (
      let index = 0;
      index < 10 && (calls < 1 || controlled.jobs.get("job-1")?.status === "running");
      index += 1
    ) {
      await Promise.resolve();
    }

    expect(calls).toBe(1);
    expect(controlled.jobs.get("job-1")?.status).toBe("queued");

    controlled.clock.set("2026-09-29T08:00:02.000Z");
    const completed = await controlled.runtime.runNext();

    expect(calls).toBe(2);
    expect(completed?.status).toBe("completed");
    controlled.runtime.stop();
  });

  it("fails closed when no handler exists", async () => {
    const { jobs, runtime } = createRuntime();
    createQueuedJob(jobs);

    runtime.start();

    for (let index = 0; index < 5 && jobs.get("job-1")?.status === "queued"; index += 1) {
      await Promise.resolve();
    }

    expect(jobs.get("job-1")?.status).toBe("failed");
    expect(jobs.get("job-1")?.error).toContain("No handler");
    runtime.stop();
  });

  it("records a fallback error when a handler throws an empty message", async () => {
    const errors: unknown[] = [];
    const { jobs, runtime } = createRuntime(undefined, {
      handlers: {
        research: async () => {
          throw new Error("");
        },
      },
      onError: (error) => errors.push(error),
    });
    createQueuedJob(jobs);
    runtime.start();

    for (let index = 0; index < 5 && errors.length === 0; index += 1) {
      await Promise.resolve();
    }

    expect(jobs.get("job-1")?.status).toBe("queued");
    expect(jobs.get("job-1")?.error).toBe("Job handler failed.");
    expect(errors).toHaveLength(1);
    runtime.stop();
  });

  it("truncates oversized handler errors to the job store limit", async () => {
    const errors: unknown[] = [];
    const { jobs, runtime } = createRuntime(undefined, {
      handlers: {
        research: async () => {
          throw new Error("x".repeat(9_000));
        },
      },
      onError: (error) => errors.push(error),
    });
    createQueuedJob(jobs, "job-1", baseTime, 1);
    runtime.start();

    for (let index = 0; index < 5 && errors.length === 0; index += 1) {
      await Promise.resolve();
    }

    expect(jobs.get("job-1")?.status).toBe("failed");
    expect(jobs.get("job-1")?.error).toHaveLength(8_000);
    expect(errors).toHaveLength(1);
    runtime.stop();
  });

  it("reports background run failures through onError instead of rejecting", async () => {
    const errors: unknown[] = [];
    const { jobs, runtime } = createRuntime(undefined, {
      handlers: { research: async () => ({ ok: true }) },
      onError: (error) => errors.push(error),
    });
    createQueuedJob(jobs);
    vi.spyOn(jobs, "start").mockImplementationOnce(() => {
      throw new Error("job store unavailable");
    });

    runtime.start();

    for (let index = 0; index < 5 && errors.length === 0; index += 1) {
      await Promise.resolve();
    }

    expect(errors).toEqual([new Error("job store unavailable")]);
    runtime.stop();
  });

  it("cancels an active job without retrying it", async () => {
    const { jobs, runtime } = createRuntime();
    createQueuedJob(jobs);

    let release: (() => void) | undefined;
    const blocked = new Promise((resolve) => {
      release = () => resolve({ ok: true });
    });

    const activeRuntime = createRuntime(undefined, {
      handlers: {
        research: async () => blocked,
      },
    });
    createQueuedJob(activeRuntime.jobs);
    activeRuntime.runtime.start();

    for (let index = 0; index < 5 && activeRuntime.runtime.activeJobCount === 0; index += 1) {
      await Promise.resolve();
    }

    expect(activeRuntime.runtime.activeJobCount).toBe(1);

    const cancelled = activeRuntime.runtime.cancel("job-1");
    expect(cancelled?.status).toBe("cancelled");
    release?.();

    await Promise.resolve();
    expect(activeRuntime.jobs.get("job-1")?.status).toBe("cancelled");
    activeRuntime.runtime.stop();

    runtime.stop();
  });
});
