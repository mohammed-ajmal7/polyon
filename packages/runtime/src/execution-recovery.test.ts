import type { Execution } from "@polyon/contracts";
import { describe, expect, it } from "vitest";

import { InMemoryExecutionQueue } from "./execution-queue";
import { recoverQueuedExecutions } from "./execution-recovery";
import { InMemoryDomainStores } from "@polyon/storage";

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
});
