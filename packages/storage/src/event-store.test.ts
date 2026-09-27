/// <reference path="./node-runtime.d.ts" />

import type { DomainEvent } from "@polyon/contracts";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";

import { FileEventStore, InMemoryEventStore } from "./event-store";

const baseEvent: DomainEvent = {
  id: "event-1",
  kind: "EXECUTION_STATUS_CHANGED",
  conversationId: "conversation-1",
  missionId: "mission-1",
  taskId: "task-1",
  executionId: "execution-1",
  occurredAt: "2026-09-27T01:00:00.000Z",
  data: { status: "RUNNING" },
};

describe("InMemoryEventStore", () => {
  it("appends and retrieves an event", () => {
    const store = new InMemoryEventStore();

    store.append(baseEvent);

    expect(store.get("event-1")).toEqual(baseEvent);
  });

  it("rejects duplicate event identifiers", () => {
    const store = new InMemoryEventStore();

    store.append(baseEvent);

    expect(() => store.append(baseEvent)).toThrow("Event already exists: event-1.");
  });

  it("lists events in insertion order", () => {
    const store = new InMemoryEventStore();

    store.append(baseEvent);
    store.append({
      ...baseEvent,
      id: "event-2",
      executionId: "execution-2",
    });

    expect(store.list().map((event) => event.id)).toEqual(["event-1", "event-2"]);
  });

  it("filters events by conversation, mission, task, and execution", () => {
    const store = new InMemoryEventStore();

    store.append(baseEvent);
    store.append({
      ...baseEvent,
      id: "event-2",
      conversationId: "conversation-2",
      missionId: "mission-2",
      taskId: "task-2",
      executionId: "execution-2",
    });
    store.append({
      ...baseEvent,
      id: "event-3",
      conversationId: "conversation-1",
      missionId: "mission-3",
      taskId: "task-3",
      executionId: "execution-3",
    });

    expect(store.listByConversation("conversation-1").map((event) => event.id)).toEqual([
      "event-1",
      "event-3",
    ]);
    expect(store.listByMission("mission-1").map((event) => event.id)).toEqual(["event-1"]);
    expect(store.listByTask("task-2").map((event) => event.id)).toEqual(["event-2"]);
    expect(store.listByExecution("execution-3").map((event) => event.id)).toEqual(["event-3"]);
  });

  it("does not expose mutable event state", () => {
    const store = new InMemoryEventStore();

    store.append({
      ...baseEvent,
      data: { details: { values: ["one"] } },
    });

    const event = store.get("event-1")!;
    (event.data.details as { values: string[] }).values.push("two");

    expect(
      (store.get("event-1")?.data.details as { values: string[] }).values,
    ).toEqual(["one"]);
  });
});



  it("persists events across store instances", () => {
    const directory = mkdtempSync(join(tmpdir(), "polyon-events-"));

    try {
      const path = join(directory, "events.json");
      const first = new FileEventStore(path);

      first.append(baseEvent);

      const second = new FileEventStore(path);

      expect(second.get("event-1")).toEqual(baseEvent);
      expect(second.listByMission("mission-1")).toEqual([baseEvent]);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("retains duplicate protection after reopening durable storage", () => {
    const directory = mkdtempSync(join(tmpdir(), "polyon-events-"));

    try {
      const path = join(directory, "events.json");
      new FileEventStore(path).append(baseEvent);

      const reopened = new FileEventStore(path);

      expect(() => reopened.append(baseEvent)).toThrow(
        "Event already exists: event-1.",
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
