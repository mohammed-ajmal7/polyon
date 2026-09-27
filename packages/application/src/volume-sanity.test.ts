import { describe, expect, it } from "vitest";

import { InMemoryDomainStores } from "@polyon/storage";
import { InMemoryExecutionQueue } from "@polyon/runtime";
import { MemoryService } from "./memory-service";

describe("POLYON volume sanity", () => {
  it("handles thousands of durable in-memory records and bounded queue volume", () => {
    const stores = new InMemoryDomainStores();
    const memory = new MemoryService(stores.memory, stores.events);

    for (let index = 0; index < 2_000; index += 1) {
      memory.remember({
        id: "memory-" + index,
        kind: "FACT",
        scope: "PROJECT",
        text: "POLYON fact " + index + " approval execution routing",
        tags: ["volume", "approval"],
        now: "2026-09-28T00:00:" + String(index % 60).padStart(2, "0") + ".000Z",
      });
    }

    for (let index = 0; index < 2_000; index += 1) {
      stores.events.append({
        id: "event-" + index,
        kind: "MESSAGE_CREATED",
        occurredAt: "2026-09-28T00:00:" + String(index % 60).padStart(2, "0") + ".000Z",
        data: { index },
      });
    }

    const queue = new InMemoryExecutionQueue();
    for (let index = 0; index < 500; index += 1) {
      queue.enqueue({
        id: "execution-" + index,
        missionId: "mission-" + index,
        taskId: "task-" + index,
        actorId: "user",
        attempt: 1,
        status: "QUEUED",
        createdAt: "2026-09-28T00:00:00.000Z",
        updatedAt: "2026-09-28T00:00:00.000Z",
      });
    }

    expect(stores.memory.list()).toHaveLength(2_000);
    expect(stores.events.list()).toHaveLength(2_000);
    expect(memory.search({ query: "approval routing", limit: 10 })).toHaveLength(10);
    expect(queue.size()).toBe(500);
    expect(queue.peek()?.id).toBe("execution-0");
  });
});
