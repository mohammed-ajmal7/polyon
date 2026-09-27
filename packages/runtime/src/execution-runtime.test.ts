/// <reference path="../../storage/src/node-runtime.d.ts" />

import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import type { Execution, Task } from "@polyon/contracts";
import {
  FileDomainStores,
  InMemoryDomainStores,
  type DomainStores,
  type EventStore,
} from "@polyon/storage";
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

function createWorkItem(index: number): {
  execution: Execution;
  task: Task;
} {
  return {
    execution: {
      ...execution,
      id: `execution-${index}`,
      taskId: `task-${index}`,
    },
    task: {
      ...task,
      id: `task-${index}`,
      title: `Build runtime ${index}`,
    },
  };
}

type RuntimeTestStores = DomainStores & {
  readonly events: EventStore;
};

function createRuntime(
  stores: RuntimeTestStores,
  overrides?: Partial<Parameters<typeof createExecutionRuntime>[0]>,
) {
  return createExecutionRuntime({
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
    ...overrides,
  });
}

describe("createExecutionRuntime", () => {
  it("constructs the queue and starts automatic execution", async () => {
    const stores = new InMemoryDomainStores();
    stores.tasks.save(task);
    stores.executions.save(execution);

    const completed = vi.fn();
    const runtime = createRuntime(stores, {
      runner: {
        async run() {
          completed();
          return { status: "SUCCEEDED", output: "Completed." };
        },
      },
    });

    expect(runtime.queue.size()).toBe(0);
    expect(runtime.status).toBe("STOPPED");

    const startup = runtime.start();

    expect(startup.recoveredExecutionIds).toEqual(["execution-1"]);
    expect(runtime.status).toBe("RUNNING");
    expect(runtime.recoveredExecutionIds()).toEqual(["execution-1"]);

    await vi.waitFor(() => {
      expect(completed).toHaveBeenCalledTimes(1);
      expect(runtime.queue.size()).toBe(0);
    });

    expect(stores.executions.get("execution-1")?.status).toBe("SUCCEEDED");

    runtime.stop();

    await vi.waitFor(() => {
      expect(runtime.activeExecutionCount).toBe(0);
    });
    expect(runtime.status).toBe("STOPPED");
    expect(runtime.worker.running).toBe(false);
    expect(runtime.activeExecutionCount).toBe(0);
  });

  it("cancels a running execution and propagates the abort signal", async () => {
    const stores = new InMemoryDomainStores();
    stores.tasks.save(task);
    stores.executions.save(execution);

    const runtime = createRuntime(stores, {
      runner: {
        async run(_execution, context) {
          return new Promise((resolve) => {
            context?.signal.addEventListener(
              "abort",
              () => resolve({ status: "CANCELLED" as const }),
              { once: true },
            );
          });
        },
      },
    });

    runtime.queue.enqueue(execution);
    runtime.start();

    await vi.waitFor(() => {
      expect(runtime.activeExecutionCount).toBe(1);
    });

    expect(runtime.cancel("execution-1").status).toBe("CANCELLED");
    expect(stores.executions.get("execution-1")?.status).toBe("CANCELLED");
    expect(stores.tasks.get("task-1")?.status).toBe("CANCELLED");

    await vi.waitFor(() => {
      expect(runtime.activeExecutionCount).toBe(0);
    });

    runtime.stop();
  });

  it("cancels queued work before it can start", async () => {
    const stores = new InMemoryDomainStores();
    stores.tasks.save(task);
    stores.executions.save(execution);

    const run = vi.fn(async () => ({ status: "SUCCEEDED" as const }));
    const runtime = createRuntime(stores, { runner: { run } });

    runtime.queue.enqueue(execution);
    expect(runtime.cancel("execution-1").status).toBe("CANCELLED");
    expect(runtime.queue.size()).toBe(0);

    runtime.start();
    await Promise.resolve();

    expect(run).not.toHaveBeenCalled();
    expect(stores.tasks.get("task-1")?.status).toBe("CANCELLED");
    runtime.stop();
  });

  it("times out an execution and persists a failed result", async () => {
    const stores = new InMemoryDomainStores();
    stores.tasks.save(task);
    stores.executions.save(execution);

    const runtime = createRuntime(stores, {
      executionTimeoutMs: 5,
      runner: {
        async run(_execution, context) {
          return new Promise((resolve) => {
            context?.signal.addEventListener(
              "abort",
              () => resolve({ status: "SUCCEEDED" as const }),
              { once: true },
            );
          });
        },
      },
    });

    runtime.queue.enqueue(execution);
    runtime.start();

    await vi.waitFor(() => {
      expect(stores.executions.get("execution-1")?.status).toBe("FAILED");
      expect(stores.executions.get("execution-1")?.error).toBe(
        "Execution timed out after the runtime execution deadline.",
      );
    });

    expect(stores.tasks.get("task-1")?.status).toBe("FAILED");
    runtime.stop();
  });

  it("does not create a second loop when started twice", async () => {
    const stores = new InMemoryDomainStores();
    stores.tasks.save(task);
    stores.executions.save(execution);

    const run = vi.fn(async () => ({ status: "SUCCEEDED" as const }));
    const runtime = createRuntime(stores, { runner: { run } });

    expect(runtime.start().recoveredExecutionIds).toEqual(["execution-1"]);
    expect(runtime.start().recoveredExecutionIds).toEqual([]);

    await vi.waitFor(() => {
      expect(run).toHaveBeenCalledTimes(1);
    });

    runtime.stop();
    await vi.waitFor(() => {
      expect(runtime.activeExecutionCount).toBe(0);
    });
    expect(runtime.activeExecutionCount).toBe(0);
  });

  it("does not leave an old loop running across stop and start", async () => {
    const stores = new InMemoryDomainStores();
    stores.tasks.save(task);

    let resolveWait: (() => void) | undefined;
    const wait = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveWait = resolve;
        }),
    );
    const run = vi.fn(async () => ({ status: "SUCCEEDED" as const }));
    const runtime = createRuntime(stores, {
      runner: { run },
      pollIntervalMs: 100,
      wait,
    });

    runtime.start();
    runtime.stop();
    runtime.start();

    stores.executions.save(execution);
    runtime.queue.enqueue(execution);

    resolveWait?.();

    await vi.waitFor(() => {
      expect(run).toHaveBeenCalledTimes(1);
    });

    runtime.stop();
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("limits automatic execution to the configured concurrency", async () => {
    const stores = new InMemoryDomainStores();
    const work = [1, 2, 3].map(createWorkItem);

    for (const item of work) {
      stores.tasks.save(item.task);
      stores.executions.save(item.execution);
    }

    let running = 0;
    let maximumRunning = 0;
    const release = new Map<string, () => void>();

    const runtime = createRuntime(stores, {
      runner: {
        async run(currentExecution) {
          running += 1;
          maximumRunning = Math.max(maximumRunning, running);

          await new Promise<void>((resolve) => {
            release.set(currentExecution.id, resolve);
          });

          running -= 1;
          return { status: "SUCCEEDED" as const };
        },
      },
      maxConcurrency: 2,
    });

    for (const item of work) {
      runtime.queue.enqueue(item.execution);
    }

    runtime.start();

    await vi.waitFor(() => {
      expect(runtime.activeExecutionCount).toBe(2);
      expect(running).toBe(2);
    });

    expect(maximumRunning).toBe(2);
    expect(runtime.queue.peek()?.id).toBe("execution-3");

    release.get("execution-1")?.();
    release.get("execution-2")?.();

    await vi.waitFor(() => {
      expect(runtime.activeExecutionCount).toBe(1);
      expect(running).toBe(1);
      expect(runtime.queue.size()).toBe(0);
      expect(runtime.worker.running).toBe(true);
    });

    release.get("execution-3")?.();

    await vi.waitFor(() => {
      expect(running).toBe(0);
      expect(runtime.activeExecutionCount).toBe(0);
      expect(stores.executions.get("execution-3")?.status).toBe("SUCCEEDED");
    });

    runtime.stop();
  });

  it("polls for work added after startup", async () => {
    const stores = new InMemoryDomainStores();
    stores.tasks.save(task);

    const run = vi.fn(async () => ({ status: "SUCCEEDED" as const }));
    const runtime = createRuntime(stores, { runner: { run } });

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
    const runtime = createRuntime(stores, {
      onError: (error) => {
        reportedErrors.push(error);
        errorReported?.();
      },
    });

    runtime.start();

    await new Promise<void>((resolve, reject) => {
      errorReported = resolve;
      setTimeout(
        () => reject(new Error("Timed out waiting for runtime error.")),
        1000,
      );
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
    const runtime = createRuntime(stores, {
      runner: { run },
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
      const runtime = createRuntime(secondProcessStores, {
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
      });

      expect(runtime.status).toBe("STOPPED");
      expect(runtime.queue.size()).toBe(0);

      const startup = runtime.start();

      expect(startup.recoveredExecutionIds).toEqual(["execution-1"]);

      await vi.waitFor(() => {
        expect(secondProcessStores.executions.get("execution-1")?.status).toBe(
          "SUCCEEDED",
        );
      });

      expect(runtime.queue.size()).toBe(0);
      runtime.stop();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("handles missing and terminal execution cancellation requests", () => {
    const stores = new InMemoryDomainStores();
    const runtime = createRuntime(stores);

    expect(runtime.cancel("missing")).toEqual({
      status: "NOT_FOUND",
      executionId: "missing",
    });

    stores.tasks.save(task);
    stores.executions.save({
      ...execution,
      status: "SUCCEEDED",
    });

    expect(runtime.cancel("execution-1").status).toBe("NOT_CANCELLABLE");
    runtime.stop();
  });

  it("retries transient coordination failures with bounded exponential backoff and reports health", async () => {
    const stores = new InMemoryDomainStores();
    stores.tasks.save({
      ...task,
      status: "READY",
    });
    stores.executions.save(execution);

    const waits: number[] = [];
    let errorCount = 0;
    const runtime = createRuntime(stores, {
      retryBackoffInitialMs: 10,
      retryBackoffMaxMs: 40,
      wait: async (milliseconds) => {
        waits.push(milliseconds);
        await new Promise((resolve) => setTimeout(resolve, milliseconds));
      },
      onError: () => {
        errorCount += 1;
        stores.tasks.save({
          ...task,
          status: "APPROVED",
        });
      },
    });

    runtime.start();

    await vi.waitFor(
      () => {
        expect(errorCount).toBe(1);
        expect(stores.executions.get("execution-1")?.status).toBe("SUCCEEDED");
      },
      { timeout: 3_000 },
    );

    expect(waits).toContain(10);
    expect(runtime.health).toMatchObject({
      status: "RUNNING",
      queuedExecutionCount: 0,
      activeExecutionCount: 0,
      recoveredExecutionCount: 1,
      consecutiveErrorCount: 0,
      retryBackoffMs: 0,
    });

    runtime.stop();
  });

  it("rejects invalid concurrency settings", () => {
    const stores = new InMemoryDomainStores();

    expect(() =>
      createRuntime(stores, {
        maxConcurrency: 0,
      }),
    ).toThrow("max concurrency must be a positive integer");

    expect(() =>
      createRuntime(stores, {
        maxConcurrency: 1.5,
      }),
    ).toThrow("max concurrency must be a positive integer");

    expect(() =>
      createRuntime(stores, {
        executionTimeoutMs: 0,
      }),
    ).toThrow("Execution runtime timeout must be a positive finite number.");

    expect(() =>
      createRuntime(stores, {
        retryBackoffInitialMs: 0,
      }),
    ).toThrow("retry backoff initial delay must be a positive finite number");

    expect(() =>
      createRuntime(stores, {
        retryBackoffInitialMs: 20,
        retryBackoffMaxMs: 10,
      }),
    ).toThrow(
      "retry backoff maximum delay must be greater than or equal to the initial delay",
    );
  });
});
