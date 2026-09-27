import type { Execution } from "@polyon/contracts";
import { describe, expect, it } from "vitest";

import { InMemoryExecutionCoordinator } from "./execution-coordinator";
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

describe("InMemoryExecutionCoordinator", () => {
  it("runs the next queued execution and completes it", async () => {
    const queue = new InMemoryExecutionQueue();
    queue.enqueue(execution);

    const coordinator = new InMemoryExecutionCoordinator(queue, {
      async run(current) {
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
    expect(queue.size()).toBe(0);
  });

  it("records runner failures as failed executions", async () => {
    const queue = new InMemoryExecutionQueue();
    queue.enqueue(execution);

    const coordinator = new InMemoryExecutionCoordinator(queue, {
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
  });

  it("records explicit runner failure results", async () => {
    const queue = new InMemoryExecutionQueue();
    queue.enqueue(execution);

    const coordinator = new InMemoryExecutionCoordinator(queue, {
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
  });

  it("returns undefined when no execution is queued", async () => {
    const coordinator = new InMemoryExecutionCoordinator(
      new InMemoryExecutionQueue(),
      {
        async run() {
          return { status: "SUCCEEDED" };
        },
      },
    );

    await expect(
      coordinator.runNext("2026-09-27T01:02:00.000Z", "2026-09-27T01:05:00.000Z"),
    ).resolves.toBeUndefined();
  });
});
