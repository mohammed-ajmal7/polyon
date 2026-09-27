import type { Execution, Task } from "@polyon/contracts";

import { InMemoryDomainStores } from "@polyon/storage";
import { describe, expect, it } from "vitest";

import { InMemoryExecutionCoordinator } from "./execution-coordinator";
import { InMemoryExecutionQueue } from "./execution-queue";
import { InMemoryExecutionWorker } from "./execution-worker";

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

describe("InMemoryExecutionWorker", () => {
  it("recovers queued work before execution starts", async () => {
    const stores = new InMemoryDomainStores();
    stores.tasks.save(task);
    stores.executions.save(execution);

    const queue = new InMemoryExecutionQueue();
    const worker = new InMemoryExecutionWorker({
      queue,
      coordinator: new InMemoryExecutionCoordinator({
        queue,
        runner: {
          async run() {
            return { status: "SUCCEEDED", output: "Recovered." };
          },
        },
        executions: stores.executions,
        tasks: stores.tasks,
        events: stores.events,
      }),
      executions: stores.executions,
      events: stores.events,
      clock: {
        now: () => "2026-09-27T01:05:00.000Z",
      },
    });

    expect(worker.start()).toEqual({
      recoveredExecutionIds: ["execution-1"],
    });
    expect(queue.size()).toBe(1);

    const result = await worker.runNext();

    expect(result?.execution.status).toBe("SUCCEEDED");
    expect(queue.size()).toBe(0);
    expect(
      stores.events.list().some((event) => event.kind === "EXECUTION_RECOVERED"),
    ).toBe(true);
  });

  it("is safe to start twice without duplicating recovered work or trace events", () => {
    const stores = new InMemoryDomainStores();
    stores.tasks.save(task);
    stores.executions.save(execution);

    const queue = new InMemoryExecutionQueue();
    const worker = new InMemoryExecutionWorker({
      queue,
      coordinator: new InMemoryExecutionCoordinator({
        queue,
        runner: {
          async run() {
            return { status: "SUCCEEDED" };
          },
        },
        executions: stores.executions,
        tasks: stores.tasks,
        events: stores.events,
      }),
      executions: stores.executions,
      events: stores.events,
      clock: { now: () => "2026-09-27T01:05:00.000Z" },
    });

    expect(worker.start().recoveredExecutionIds).toEqual(["execution-1"]);
    expect(worker.start().recoveredExecutionIds).toEqual([]);
    expect(queue.size()).toBe(1);
    expect(stores.events.list()).toHaveLength(1);
  });

  it("requires startup before execution and can stop cleanly", async () => {
    const stores = new InMemoryDomainStores();
    stores.tasks.save(task);
    stores.executions.save(execution);

    const queue = new InMemoryExecutionQueue();
    const worker = new InMemoryExecutionWorker({
      queue,
      coordinator: new InMemoryExecutionCoordinator({
        queue,
        runner: {
          async run() {
            return { status: "SUCCEEDED" };
          },
        },
        executions: stores.executions,
        tasks: stores.tasks,
        events: stores.events,
      }),
      executions: stores.executions,
      events: stores.events,
      clock: { now: () => "2026-09-27T01:05:00.000Z" },
    });

    await expect(worker.runNext()).rejects.toMatchObject({
      kind: "WORKER_NOT_RUNNING",
    });

    worker.start();
    worker.stop();

    await expect(worker.runNext()).rejects.toMatchObject({
      kind: "WORKER_NOT_RUNNING",
    });
  });

  it("requeues persisted work when coordination rejects it before running", async () => {
    const stores = new InMemoryDomainStores();
    stores.tasks.save({
      ...task,
      status: "READY",
    });
    stores.executions.save(execution);

    const queue = new InMemoryExecutionQueue();
    const worker = new InMemoryExecutionWorker({
      queue,
      coordinator: new InMemoryExecutionCoordinator({
        queue,
        runner: {
          async run() {
            return { status: "SUCCEEDED" };
          },
        },
        executions: stores.executions,
        tasks: stores.tasks,
        events: stores.events,
      }),
      executions: stores.executions,
      events: stores.events,
      clock: { now: () => "2026-09-27T01:05:00.000Z" },
    });

    worker.start();

    await expect(worker.runNext()).rejects.toMatchObject({
      kind: "TASK_STATE_NOT_EXECUTABLE",
    });
    expect(queue.size()).toBe(1);
    expect(stores.executions.get("execution-1")?.status).toBe("QUEUED");
  });
});
