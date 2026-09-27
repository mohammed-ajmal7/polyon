/// <reference path="../../storage/src/node-runtime.d.ts" />

import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import type { Execution, Task } from "@polyon/contracts";
import { InMemoryExecutionCoordinator } from "./execution-coordinator";
import { InMemoryExecutionQueue } from "./execution-queue";
import { recoverQueuedExecutions } from "./execution-recovery";
import { describe, expect, it } from "vitest";

import { FileDomainStores, InMemoryDomainStores } from "@polyon/storage";

const queued = (id: string): Execution => ({
  id,
  missionId: "mission-1",
  taskId: id,
  actorId: "agent-1",
  attempt: 1,
  status: "QUEUED",
  createdAt: "2026-09-27T01:00:00.000Z",
  updatedAt: "2026-09-27T01:00:00.000Z",
});

const approvedTask: Task = {
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

describe("recoverQueuedExecutions", () => {
  it("restores persisted queued executions that are missing from the queue", () => {
    const stores = new InMemoryDomainStores();
    const queue = new InMemoryExecutionQueue();

    stores.executions.save(queued("execution-1"));
    stores.executions.save({
      ...queued("execution-2"),
      status: "RUNNING",
    });

    expect(recoverQueuedExecutions(stores.executions, queue)).toEqual(["execution-1"]);
    expect(queue.peek()?.id).toBe("execution-1");
  });

  it("does not duplicate executions already present in the queue", () => {
    const stores = new InMemoryDomainStores();
    const queue = new InMemoryExecutionQueue();
    const execution = queued("execution-1");

    stores.executions.save(execution);
    queue.enqueue(execution);

    expect(recoverQueuedExecutions(stores.executions, queue)).toEqual([]);
    expect(queue.size()).toBe(1);
  });

  it("recovers a queued execution after a durable-store restart", async () => {
    const directory = mkdtempSync(join(tmpdir(), "polyon-runtime-"));

    try {
      const firstProcessStores = new FileDomainStores(directory);
      firstProcessStores.tasks.save(approvedTask);
      firstProcessStores.executions.save(queued("execution-1"));

      const secondProcessStores = new FileDomainStores(directory);
      const recoveredQueue = new InMemoryExecutionQueue();

      expect(recoveredQueue.size()).toBe(0);
      expect(recoverQueuedExecutions(secondProcessStores.executions, recoveredQueue)).toEqual([
        "execution-1",
      ]);

      const coordinator = new InMemoryExecutionCoordinator({
        queue: recoveredQueue,
        runner: {
          async run(current) {
            expect(current.id).toBe("execution-1");
            expect(current.status).toBe("RUNNING");
            return {
              status: "SUCCEEDED",
              output: "Recovered execution completed.",
            };
          },
        },
        executions: secondProcessStores.executions,
        tasks: secondProcessStores.tasks,
        events: secondProcessStores.events,
      });

      const result = await coordinator.runNextWithResult(
        "2026-09-27T01:05:00.000Z",
        "2026-09-27T01:06:00.000Z",
      );

      expect(result?.execution.status).toBe("SUCCEEDED");
      expect(result?.result.output).toBe("Recovered execution completed.");
      expect(new FileDomainStores(directory).executions.get("execution-1")?.status).toBe(
        "SUCCEEDED",
      );
      expect(recoveredQueue.size()).toBe(0);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
