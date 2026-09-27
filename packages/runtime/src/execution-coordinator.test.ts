import type { Execution } from "@polyon/contracts";
import { describe, expect, it } from "vitest";

import { InMemoryDomainStores } from "@polyon/storage";

import {
  ExecutionCoordinatorError,
  InMemoryExecutionCoordinator,
  type ExecutionCoordinatorDependencies,
} from "./execution-coordinator";
import type { ExecutionRunner } from "./execution-runner";
import { InMemoryExecutionQueue } from "./execution-queue";

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

function createCoordinator(runner: ExecutionRunner) {
  const stores = new InMemoryDomainStores();
  const queue = new InMemoryExecutionQueue();

  stores.executions.save(execution);
  queue.enqueue(execution);

  const dependencies: ExecutionCoordinatorDependencies = {
    queue,
    runner,
    executions: stores.executions,
  };

  return {
    stores,
    queue,
    coordinator: new InMemoryExecutionCoordinator(dependencies),
  };
}

describe("InMemoryExecutionCoordinator", () => {
  it("persists RUNNING before invoking the runner and persists success", async () => {
    const { stores, queue, coordinator } = createCoordinator({
      async run(current) {
        expect(stores.executions.get("execution-1")?.status).toBe("RUNNING");
        expect(current.status).toBe("RUNNING");
        expect(current.startedAt).toBe("2026-09-27T01:02:00.000Z");

        return { status: "SUCCEEDED" };
      },
    });

    await expect(
      coordinator.runNext("2026-09-27T01:02:00.000Z", "2026-09-27T01:05:00.000Z"),
    ).resolves.toEqual({
      ...execution,
      status: "SUCCEEDED",
      startedAt: "2026-09-27T01:02:00.000Z",
      completedAt: "2026-09-27T01:05:00.000Z",
      updatedAt: "2026-09-27T01:05:00.000Z",
    });
    expect(stores.executions.get("execution-1")?.status).toBe("SUCCEEDED");
    expect(queue.size()).toBe(0);
  });

  it("records runner failures as failed executions", async () => {
    const { stores, coordinator } = createCoordinator({
      async run() {
        throw new Error("Provider unavailable.");
      },
    });

    await expect(
      coordinator.runNext("2026-09-27T01:02:00.000Z", "2026-09-27T01:05:00.000Z"),
    ).resolves.toMatchObject({
      status: "FAILED",
      error: "Provider unavailable.",
    });
    expect(stores.executions.get("execution-1")).toMatchObject({
      status: "FAILED",
      error: "Provider unavailable.",
    });
  });

  it("records explicit runner failure results", async () => {
    const { stores, coordinator } = createCoordinator({
      async run() {
        return {
          status: "FAILED",
          error: "Model returned an invalid response.",
        };
      },
    });

    await expect(
      coordinator.runNext("2026-09-27T01:02:00.000Z", "2026-09-27T01:05:00.000Z"),
    ).resolves.toMatchObject({
      status: "FAILED",
      error: "Model returned an invalid response.",
    });
    expect(stores.executions.get("execution-1")).toMatchObject({
      status: "FAILED",
      error: "Model returned an invalid response.",
    });
  });

  it("fails closed when a queued execution is not persisted", async () => {
    const queue = new InMemoryExecutionQueue();
    let invoked = false;
    const runner: ExecutionRunner = {
      async run() {
        invoked = true;
        return { status: "SUCCEEDED" };
      },
    };

    queue.enqueue(execution);

    const coordinator = new InMemoryExecutionCoordinator({
      queue,
      runner,
      executions: new InMemoryDomainStores().executions,
    });

    await expect(
      coordinator.runNext("2026-09-27T01:02:00.000Z", "2026-09-27T01:05:00.000Z"),
    ).rejects.toMatchObject({
      name: "ExecutionCoordinatorError",
      kind: "EXECUTION_NOT_PERSISTED",
    });
    expect(invoked).toBe(false);
    expect(queue.size()).toBe(0);
  });

  it("fails closed when persisted state is no longer queued", async () => {
    const stores = new InMemoryDomainStores();
    const queue = new InMemoryExecutionQueue();
    let invoked = false;
    const runner: ExecutionRunner = {
      async run() {
        invoked = true;
        return { status: "SUCCEEDED" };
      },
    };

    stores.executions.save({
      ...execution,
      status: "CANCELLED",
    });
    queue.enqueue(execution);

    const coordinator = new InMemoryExecutionCoordinator({
      queue,
      runner,
      executions: stores.executions,
    });

    await expect(
      coordinator.runNext("2026-09-27T01:02:00.000Z", "2026-09-27T01:05:00.000Z"),
    ).rejects.toMatchObject({
      name: "ExecutionCoordinatorError",
      kind: "PERSISTED_EXECUTION_NOT_QUEUED",
    });
    expect(invoked).toBe(false);
    expect(queue.size()).toBe(0);
  });

  it("returns undefined when no execution is queued", async () => {
    const stores = new InMemoryDomainStores();
    const coordinator = new InMemoryExecutionCoordinator({
      queue: new InMemoryExecutionQueue(),
      runner: {
        async run() {
          return { status: "SUCCEEDED" };
        },
      },
      executions: stores.executions,
    });

    await expect(
      coordinator.runNext("2026-09-27T01:02:00.000Z", "2026-09-27T01:05:00.000Z"),
    ).resolves.toBeUndefined();
  });
});
