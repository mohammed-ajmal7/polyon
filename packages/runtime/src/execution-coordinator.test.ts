import type { Execution, Task } from "@polyon/contracts";
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

const runningTask: Task = {
  id: "task-1",
  missionId: "mission-1",
  kind: "CODING",
  title: "Build runtime",
  description: "Implement runtime.",
  status: "RUNNING",
  dependsOn: [],
  createdAt: "2026-09-27T01:00:00.000Z",
  updatedAt: "2026-09-27T01:01:00.000Z",
};

const approvedTask: Task = {
  ...runningTask,
  status: "APPROVED",
};

function createCoordinator(
  task: Task = runningTask,
  runner: ExecutionRunner = {
    async run() {
      return { status: "SUCCEEDED" };
    },
  },
) {
  const stores = new InMemoryDomainStores();
  const queue = new InMemoryExecutionQueue();

  stores.executions.save(execution);
  stores.tasks.save(task);
  queue.enqueue(execution);

  const dependencies: ExecutionCoordinatorDependencies = {
    queue,
    runner,
    executions: stores.executions,
    tasks: stores.tasks,
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
      ...runningTask,
      status: "RUNNING",
    }, {
      async run(current) {
        expect(stores.executions.get("execution-1")?.status).toBe("RUNNING");
        expect(stores.tasks.get("task-1")?.status).toBe("RUNNING");
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
    expect(stores.tasks.get("task-1")?.status).toBe("SUCCEEDED");
    expect(queue.size()).toBe(0);
  });

  it("moves an approved task to RUNNING before the runner starts", async () => {
    const { stores, coordinator } = createCoordinator(approvedTask, {
      async run() {
        expect(stores.tasks.get("task-1")?.status).toBe("RUNNING");
        return { status: "SUCCEEDED" };
      },
    });

    await coordinator.runNext(
      "2026-09-27T01:02:00.000Z",
      "2026-09-27T01:05:00.000Z",
    );

    expect(stores.tasks.get("task-1")?.status).toBe("SUCCEEDED");
  });

  it("records runner failures as failed executions and tasks", async () => {
    const { stores, coordinator } = createCoordinator(runningTask, {
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
    expect(stores.tasks.get("task-1")?.status).toBe("FAILED");
  });

  it("records explicit runner failure results", async () => {
    const { stores, coordinator } = createCoordinator(runningTask, {
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
    expect(stores.tasks.get("task-1")?.status).toBe("FAILED");
  });

  it("fails closed when a queued execution is not persisted", async () => {
    const stores = new InMemoryDomainStores();
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
      executions: stores.executions,
      tasks: stores.tasks,
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

  it("fails closed when the execution task is not persisted", async () => {
    const stores = new InMemoryDomainStores();
    const queue = new InMemoryExecutionQueue();
    let invoked = false;
    const runner: ExecutionRunner = {
      async run() {
        invoked = true;
        return { status: "SUCCEEDED" };
      },
    };

    stores.executions.save(execution);
    queue.enqueue(execution);

    const coordinator = new InMemoryExecutionCoordinator({
      queue,
      runner,
      executions: stores.executions,
      tasks: stores.tasks,
    });

    await expect(
      coordinator.runNext("2026-09-27T01:02:00.000Z", "2026-09-27T01:05:00.000Z"),
    ).rejects.toMatchObject({
      name: "ExecutionCoordinatorError",
      kind: "TASK_NOT_PERSISTED",
    });
    expect(invoked).toBe(false);
    expect(queue.size()).toBe(0);
  });

  it("fails closed when persisted execution or task state is no longer executable", async () => {
    const stores = new InMemoryDomainStores();
    const queue = new InMemoryExecutionQueue();
    const runner: ExecutionRunner = {
      async run() {
        return { status: "SUCCEEDED" };
      },
    };

    stores.executions.save(execution);
    stores.tasks.save({
      ...runningTask,
      status: "CANCELLED",
    });
    queue.enqueue(execution);

    const coordinator = new InMemoryExecutionCoordinator({
      queue,
      runner,
      executions: stores.executions,
      tasks: stores.tasks,
    });

    await expect(
      coordinator.runNext("2026-09-27T01:02:00.000Z", "2026-09-27T01:05:00.000Z"),
    ).rejects.toMatchObject({
      name: "ExecutionCoordinatorError",
      kind: "TASK_STATE_NOT_EXECUTABLE",
    });
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
      tasks: stores.tasks,
    });

    await expect(
      coordinator.runNext("2026-09-27T01:02:00.000Z", "2026-09-27T01:05:00.000Z"),
    ).resolves.toBeUndefined();
  });
});
