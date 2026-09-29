import { describe, expect, it } from "vitest";

import {
  FileDomainStores,
  InMemoryDomainStores,
  type DomainUnitOfWork,
  type EventStore,
  type JobStore,
} from "@polyon/storage";

import { JobService } from "./job-service";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const createdAt = "2026-09-29T08:00:00.000Z";

function createService(
  stores: DomainUnitOfWork & {
    readonly jobs: JobStore;
    readonly events: EventStore;
  } = new InMemoryDomainStores(),
): JobService {
  return new JobService({
    jobs: stores.jobs,
    events: stores.events,
    unitOfWork: stores,
  });
}

function createJob(service: JobService, id = "job-1") {
  return service.create({
    id,
    userId: "user-1",
    kind: "research",
    payload: { query: "POLYON" },
    runAt: createdAt,
    maxAttempts: 2,
    createdAt,
  });
}

describe("JobService", () => {
  it("creates a queued job and emits a durable creation event", () => {
    const stores = new InMemoryDomainStores();
    const service = createService(stores);

    const job = createJob(service);

    expect(job.status).toBe("queued");
    expect(job.attempt).toBe(0);
    expect(job.maxAttempts).toBe(2);
    expect(stores.jobs.get("job-1")).toEqual(job);
    expect(stores.events.get("JOB_CREATED:job-1")?.kind).toBe("JOB_CREATED");
  });

  it("advances a job through running and completed states", () => {
    const stores = new InMemoryDomainStores();
    const service = createService(stores);

    createJob(service);
    const running = service.start("job-1", "2026-09-29T08:00:01.000Z");
    const completed = service.complete({
      id: "job-1",
      result: { sources: 3 },
      completedAt: "2026-09-29T08:00:02.000Z",
    });

    expect(running.status).toBe("running");
    expect(running.attempt).toBe(1);
    expect(completed.status).toBe("completed");
    expect(completed.result).toEqual({ sources: 3 });
    expect(completed.completedAt).toBe("2026-09-29T08:00:02.000Z");
  });

  it("requeues retryable failures and eventually records a terminal failure", () => {
    const stores = new InMemoryDomainStores();
    const service = createService(stores);

    createJob(service);
    service.start("job-1", "2026-09-29T08:00:01.000Z");

    const retry = service.fail({
      id: "job-1",
      error: "temporary failure",
      retryAt: "2026-09-29T08:00:03.000Z",
      occurredAt: "2026-09-29T08:00:02.000Z",
    });

    expect(retry.status).toBe("queued");
    expect(retry.runAt).toBe("2026-09-29T08:00:03.000Z");
    expect(retry.attempt).toBe(1);

    service.start("job-1", "2026-09-29T08:00:03.000Z");
    const failed = service.fail({
      id: "job-1",
      error: "permanent failure",
      occurredAt: "2026-09-29T08:00:04.000Z",
    });

    expect(failed.status).toBe("failed");
    expect(failed.attempt).toBe(2);
    expect(failed.error).toBe("permanent failure");
  });

  it("cancels queued and running jobs but rejects terminal transitions", () => {
    const service = createService();

    createJob(service);
    expect(service.cancel("job-1", "2026-09-29T08:00:01.000Z").status).toBe("cancelled");
    expect(() => service.cancel("job-1", "2026-09-29T08:00:02.000Z")).toThrow(
      "Invalid job transition: cancelled -> cancelled.",
    );
  });

  it("recovers interrupted running jobs back to the queueable state", () => {
    const stores = new InMemoryDomainStores();
    const service = createService(stores);

    createJob(service);
    service.start("job-1", "2026-09-29T08:00:01.000Z");

    const recovered = service.recoverRunningJobs({
      recoveredAt: "2026-09-29T08:05:00.000Z",
    });

    expect(recovered[0]?.status).toBe("queued");
    expect(recovered[0]?.runAt).toBe("2026-09-29T08:05:00.000Z");
    expect(recovered[0]?.attempt).toBe(1);
    expect(stores.events.list().some((event) => event.kind === "JOB_RECOVERED")).toBe(true);
  });

  it("fails interrupted running jobs that have exhausted their attempts", () => {
    const stores = new InMemoryDomainStores();
    const service = createService(stores);

    createJob(service);
    service.start("job-1", "2026-09-29T08:00:01.000Z");
    service.fail({
      id: "job-1",
      error: "temporary failure",
      retryAt: "2026-09-29T08:00:02.000Z",
      occurredAt: "2026-09-29T08:00:01.500Z",
    });
    service.start("job-1", "2026-09-29T08:00:02.000Z");

    const recovered = service.recoverRunningJobs({
      recoveredAt: "2026-09-29T08:05:00.000Z",
    });

    expect(recovered).toEqual([]);
    const job = service.get("job-1");
    expect(job?.status).toBe("failed");
    expect(job?.attempt).toBe(2);
    expect(job?.completedAt).toBe("2026-09-29T08:05:00.000Z");
    expect(job?.error).toContain("interrupted");
    expect(stores.events.list().some((event) => event.kind === "JOB_RECOVERED")).toBe(false);
  });

  it("persists jobs across FileDomainStores restarts", () => {
    const directory = mkdtempSync(join(tmpdir(), "polyon-job-service-"));

    try {
      const first = new FileDomainStores(directory);
      createService(first).create({
        id: "job-restart",
        userId: "user-1",
        kind: "embedding",
        payload: { documentId: "doc-1" },
        runAt: createdAt,
        createdAt,
      });

      const second = new FileDomainStores(directory);

      expect(second.jobs.get("job-restart")?.kind).toBe("embedding");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
