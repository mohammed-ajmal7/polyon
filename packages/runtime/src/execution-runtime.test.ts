/// <reference path="../../storage/src/node-runtime.d.ts" />

import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import type { Execution, Task } from "@polyon/contracts";
import { FileDomainStores, InMemoryDomainStores } from "@polyon/storage";
import { describe, expect, it, vi } from "vitest";

import { createExecutionRuntime } from "./execution-runtime";

const execution: Execution = {
  id: "execution-1",
  missionId: "mission-1",
  taskId: "task-1",
  actorId: "agent-1",
  attempt: 1,
  status: "QUEUED",
  createdAt: "2026-09-27T01:00:00.000Z",
  updatedAt: "2026-09-27T01:00:00.000Z",
};

const task: Task = {
  id: "task-1",
  missionId: "mission-1",
  kind: "CODING",
  title: "Build runtime",
  description: "Implement runtime.",
  status: "APPROVED",
  dependsOn: [],
  createdAt: "2026-09-27T01:00:00.000Z",
  updatedAt: "2026-09-27T01:00:00.000Z",
};

describe("createExecutionRuntime", () => {
  it("constructs the queue and starts automatic execution", async () => {
    const stores = new InMemoryDomainStores();
    stores.tasks.save(task);
    stores.executions.save(execution);

    const completed = vi.fn();
    const runtime = createExecutionRuntime({
      runner: {
        async run() {
          completed();
          return { status: "SUCCEEDED", output: "Completed." };
        },
      },
      executions: stores.executions,
      tasks: stores.tasks,
      events: stores.events,
      clock: {
        now: () => "2026-09-27T01:05:00.000Z",
      },
      pollIntervalMs: 0,
    });

    expect(runtime.queue.size()).toBe(0);
    expect(runtime.status).toBe("STOPPED");

    const startup = runtime.start();

    expect(startup.recoveredExecutionIds).toEqual(["execution-1"]);
    expect(runtime.queue.size()).toBe(1);
    expect(runtime.status).toBe("RUNNING");
    expect(runtime.recoveredExecutionIds()).toEqual(["execution-1"]);

    await vi.waitFor(() => {
      expect(completed).toHaveBeenCalledTimes(1);
      expect(runtime.queue.size()).toBe(0);
    });

    expect(stores.executions.get("execution-1")?.status).toBe("SUCCEEDED");

    runtime.stop();

    expect(runtime.status).toBe("STOPPED");
    expect(runtime.worker.running).toBe(false);
  });

  it("does not create a second loop when started twice", async () => {
    const stores = new InMemoryDomainStores();
    stores.tasks.save(task);
    stores.executions.save(execution);

    const run = vi.fn(async () => ({ status: "SUCCEEDED" as const }));

    const runtime = createExecutionRuntime({
      runner: { run },
      executions: stores.executions,
      tasks: stores.tasks,
      events: stores.events,
      clock: { now: () => "2026-09-27T01:05:00.000Z" },
      pollIntervalMs: 0,
    });

    expect(runtime.start().recoveredExecutionIds).toEqual(["execution-1"]);
    expect(runtime.start().recoveredExecutionIds).toEqual([]);

    await vi.waitFor(() => {
      expect(run).toHaveBeenCalledTimes(1);
    });

    runtime.stop();
  });

  it("polls for work added after startup", async () => {
    const stores = new InMemoryDomainStores();
    stores.tasks.save(task);

    const run = vi.fn(async () => ({ status: "SUCCEEDED" as const }));
    const runtime = createExecutionRuntime({
      runner: { run },
      executions: stores.executions,
      tasks: stores.tasks,
      events: stores.events,
      clock: { now: () => "2026-09-27T01:05:00.000Z" },
      pollIntervalMs: 0,
    });

    runtime.start();

    stores.executions.save(execution);
    runtime.queue.enqueue(execution);

    await vi.waitFor(() => {
      expect(run).toHaveBeenCalledTimes(1);
    });

    expect(stores.executions.get("execution-1")?.status).toBe("SUCCEEDED");

    runtime.stop();
  });

  it("reports coordinator errors without terminating the runtime loop", async () => {
    const stores = new InMemoryDomainStores();
    stores.tasks.save({
      ...task,
      status: "READY",
    });
    stores.executions.save(execution);

    const reportedErrors: unknown[] = [];
    let errorReported: (() => void) | undefined;
    const runtime = createExecutionRuntime({
      runner: {
        async run() {
          return { status: "SUCCEEDED" as const };
        },
      },
      executions: stores.executions,
      tasks: stores.tasks,
      events: stores.events,
      clock: { now: () => "2026-09-27T01:05:00.000Z" },
      pollIntervalMs: 0,
      onError: (error) => {
        reportedErrors.push(error);
        errorReported?.();
      },
    });

    runtime.start();

    await new Promise<void>((resolve, reject) => {
      errorReported = resolve;
      setTimeout(() => reject(new Error("Timed out waiting for runtime error.")), 1000);
    });

    expect(reportedErrors).toHaveLength(1);
    expect(runtime.status).toBe("RUNNING");
    expect(runtime.queue.size()).toBe(1);

    runtime.stop();
  });

  it("stops executing queued work after stop", async () => {
    const stores = new InMemoryDomainStores();
    stores.tasks.save(task);

    let waitResolve: (() => void) | undefined;
    const wait = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          waitResolve = resolve;
        }),
    );
    const run = vi.fn(async () => ({ status: "SUCCEEDED" as const }));
    const runtime = createExecutionRuntime({
      runner: { run },
      executions: stores.executions,
      tasks: stores.tasks,
      events: stores.events,
      clock: { now: () => "2026-09-27T01:05:00.000Z" },
      pollIntervalMs: 10,
      wait,
    });

    runtime.start();
    runtime.stop();

    stores.executions.save(execution);
    runtime.queue.enqueue(execution);

    waitResolve?.();
    await Promise.resolve();
    await Promise.resolve();

    expect(run).not.toHaveBeenCalled();
  });

  it("recovers durable queued work when a fresh runtime starts after restart", async () => {
    const directory = mkdtempSync(join(tmpdir(), "polyon-execution-runtime-"));

    try {
      const firstProcessStores = new FileDomainStores(directory);
      firstProcessStores.tasks.save(task);
      firstProcessStores.executions.save(execution);

      const secondProcessStores = new FileDomainStores(directory);
      const runtime = createExecutionRuntime({
        runner: {
          async run(currentExecution) {
            expect(currentExecution.id).toBe("execution-1");
            expect(currentExecution.status).toBe("RUNNING");
            return {
              status: "SUCCEEDED",
              output: "Recovered after startup.",
            };
          },
        },
        executions: secondProcessStores.executions,
        tasks: secondProcessStores.tasks,
        events: secondProcessStores.events,
        clock: {
          now: () => "2026-09-27T01:05:00.000Z",
        },
        pollIntervalMs: 0,
      });

      expect(runtime.status).toBe("STOPPED");
      expect(runtime.queue.size()).toBe(0);

      const startup = runtime.start();

      expect(startup.recoveredExecutionIds).toEqual(["execution-1"]);
      expect(runtime.queue.peek()?.id).toBe("execution-1");

      await vi.waitFor(() => {
        expect(secondProcessStores.executions.get("execution-1")?.status).toBe("SUCCEEDED");
      });

      expect(runtime.queue.size()).toBe(0);
      runtime.stop();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
