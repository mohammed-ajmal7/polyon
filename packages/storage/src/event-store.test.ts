import type { DomainEvent } from "@polyon/contracts";
import { describe, expect, it } from "vitest";

import { InMemoryEventStore } from "./event-store";

const baseEvent: DomainEvent = {
  id: "event-1",
  kind: "EXECUTION_STATUS_CHANGED",
  missionId: "mission-1",
  taskId: "task-1",
  executionId: "execution-1",
  traceId: "trace-1",
  occurredAt: "2026-09-27T01:00:00.000Z",
  data: {
    from: "PENDING",
    to: "QUEUED",
  },
};

describe("InMemoryEventStore", () => {
  it("appends and retrieves events", () => {
    const store = new InMemoryEventStore();

    store.append(baseEvent);

    expect(store.get("event-1")).toEqual(baseEvent);
  });

  it("rejects duplicate event identifiers", () => {
    const store = new InMemoryEventStore();

    store.append(baseEvent);

    expect(() => store.append(baseEvent)).toThrow("Event already exists: event-1.");
  });

  it("lists events in append order", () => {
    const store = new InMemoryEventStore();

    store.append(baseEvent);
    store.append({
      ...baseEvent,
      id: "event-2",
      occurredAt: "2026-09-27T01:01:00.000Z",
    });

    expect(store.list().map((event) => event.id)).toEqual(["event-1", "event-2"]);
  });

  it("filters events by execution", () => {
    const store = new InMemoryEventStore();

    store.append(baseEvent);
    store.append({
      ...baseEvent,
      id: "event-2",
      executionId: "execution-2",
    });

    expect(store.listByExecution("execution-1")).toEqual([baseEvent]);
  });

  it("filters events by mission and task", () => {
    const store = new InMemoryEventStore();

    store.append(baseEvent);
    store.append({
      ...baseEvent,
      id: "event-2",
      taskId: "task-2",
    });

    expect(store.listByMission("mission-1")).toHaveLength(2);
    expect(store.listByTask("task-2").map((event) => event.id)).toEqual(["event-2"]);
  });

  it("does not expose mutable event state", () => {
    const store = new InMemoryEventStore();
    store.append(baseEvent);

    const retrieved = store.get("event-1")!;
    (retrieved.data as { from: string }).from = "TAMPERED";

    expect((store.get("event-1")?.data as { from: string }).from).toBe("PENDING");
  });
});
