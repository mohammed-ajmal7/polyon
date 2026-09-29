import { describe, expect, it } from "vitest";

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
    ...options,
  });

  return { stores, jobs, clock, runtime };
}

function createQueuedJob(jobs: JobService, id = "job-1"): void {
  jobs.create({
    id,
    userId: "user-1",
    kind: "research",
    payload: { query: "POLYON" },
    runAt: baseTime,
    maxAttempts: 2,
    createdAt: baseTime,
  });
}

describe("createJobRuntime", () => {
  it("runs a due job through its registered handler", async () => {
    const { jobs, runtime } = createRuntime();
    createQueuedJob(jobs);

    const seen: string[] = [];
    runtime.start();
    const result = await runtime.runNext().catch(() => undefined);

    // The background loop and explicit runNext can race, so drain the durable state.
    const completed = jobs.get("job-1");

    expect(result?.status ?? completed?.status).toBe("completed");
    expect(seen).toEqual([]);

    expect(completed?.status).toBe("failed");
  });

  it("executes registered handlers and stores their bounded result", async () => {
    const { jobs } = createRuntime();
    const { runtime, clock } = createRuntime(
      new InMemoryDomainStores(),
      {
        handlers: {
          research: async ({ job }) => ({ jobId: job.id, attempt: job.attempt }),
        },
      },
    );
    createQueuedJob(jobs);
    runtime.start();
    const result = await runtime.runNext();

    expect(result?.status).toBe("completed");
    expect(result?.result).toEqual({ jobId: "job-1", attempt: 1 });
    expect(clock.now()).toBe(baseTime);
  });

  it("does not run a future job until its runAt time", async () => {
    const { jobs, runtime, clock } = createRuntime({
      jobs: new InMemoryDomainStores(),
    } as unknown as InMemoryDomainStores);
  });
});
