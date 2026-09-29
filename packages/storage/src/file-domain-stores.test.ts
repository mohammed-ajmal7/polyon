/// <reference path="./node-runtime.d.ts" />

import { mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";

import { FileDomainStores } from "./file-domain-stores";
import { InMemoryDomainStores } from "./domain-stores";

describe("InMemoryDomainStores", () => {
  it("rejects nested transactions", () => {
    const stores = new InMemoryDomainStores();

    expect(() => stores.transaction(() => stores.transaction(() => undefined))).toThrow(
      "A storage transaction is already in progress.",
    );
  });

  it("rolls back all domain collections and events when a transaction throws", () => {
    const stores = new InMemoryDomainStores();

    expect(() =>
      stores.transaction(({ missions, events }) => {
        missions.save({
          id: "mission-rollback-1",
          objective: "Should roll back.",
          constraints: [],
          status: "DRAFT",
          taskIds: [],
          createdAt: "2026-09-27T04:00:00.000Z",
          updatedAt: "2026-09-27T04:00:00.000Z",
        });
        events.append({
          id: "event-rollback-1",
          kind: "MISSION_CREATED",
          missionId: "mission-rollback-1",
          occurredAt: "2026-09-27T04:00:00.000Z",
          data: {},
        });
        throw new Error("rollback");
      }),
    ).toThrow("rollback");

    expect(stores.missions.get("mission-rollback-1")).toBeUndefined();
    expect(stores.events.get("event-rollback-1")).toBeUndefined();
  });
});

describe("FileDomainStores", () => {
  it("rejects nested transactions", () => {
    const directory = mkdtempSync(join(tmpdir(), "polyon-domain-"));

    try {
      const stores = new FileDomainStores(directory);

      expect(() => stores.transaction(() => stores.transaction(() => undefined))).toThrow(
        "A storage transaction is already in progress.",
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("recovers a stale commit lock after a crashed writer", () => {
    const directory = mkdtempSync(join(tmpdir(), "polyon-domain-"));

    try {
      const stores = new FileDomainStores(directory);
      const lockPath = join(directory, "domain-state.json.lock");
      const staleTime = new Date(Date.now() - 10 * 60 * 1000);

      writeFileSync(lockPath, "stale", "utf8");
      utimesSync(lockPath, staleTime, staleTime);

      stores.missions.save({
        id: "mission-stale-lock-1",
        objective: "Recover after crash.",
        constraints: [],
        status: "DRAFT",
        taskIds: [],
        createdAt: "2026-09-27T04:04:00.000Z",
        updatedAt: "2026-09-27T04:04:00.000Z",
      });

      expect(new FileDomainStores(directory).missions.get("mission-stale-lock-1")).toBeDefined();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("rejects a stale writer instead of overwriting newer state", () => {
    const directory = mkdtempSync(join(tmpdir(), "polyon-domain-"));

    try {
      const first = new FileDomainStores(directory);
      const second = new FileDomainStores(directory);

      first.missions.save({
        id: "mission-1",
        objective: "Newer state.",
        constraints: [],
        status: "DRAFT",
        taskIds: [],
        createdAt: "2026-09-27T04:00:00.000Z",
        updatedAt: "2026-09-27T04:00:00.000Z",
      });

      expect(() =>
        second.missions.save({
          id: "mission-2",
          objective: "Stale state.",
          constraints: [],
          status: "DRAFT",
          taskIds: [],
          createdAt: "2026-09-27T04:01:00.000Z",
          updatedAt: "2026-09-27T04:01:00.000Z",
        }),
      ).toThrow("Durable storage changed while the write was in progress");

      const reopened = new FileDomainStores(directory);

      expect(reopened.missions.get("mission-1")?.objective).toBe("Newer state.");
      expect(reopened.missions.get("mission-2")).toBeUndefined();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("rejects a transaction that becomes stale during its work", () => {
    const directory = mkdtempSync(join(tmpdir(), "polyon-domain-"));

    try {
      const first = new FileDomainStores(directory);
      const second = new FileDomainStores(directory);

      expect(() =>
        first.transaction(({ missions }) => {
          missions.save({
            id: "mission-transaction-1",
            objective: "Stale transaction.",
            constraints: [],
            status: "DRAFT",
            taskIds: [],
            createdAt: "2026-09-27T04:02:00.000Z",
            updatedAt: "2026-09-27T04:02:00.000Z",
          });

          second.missions.save({
            id: "mission-concurrent-1",
            objective: "Concurrent write.",
            constraints: [],
            status: "DRAFT",
            taskIds: [],
            createdAt: "2026-09-27T04:03:00.000Z",
            updatedAt: "2026-09-27T04:03:00.000Z",
          });
        }),
      ).toThrow("Durable storage changed while the write was in progress");

      const reopened = new FileDomainStores(directory);

      expect(reopened.missions.get("mission-transaction-1")).toBeUndefined();
      expect(reopened.missions.get("mission-concurrent-1")?.objective).toBe("Concurrent write.");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("reopens the same durable domain stores without losing entities", () => {
    const directory = mkdtempSync(join(tmpdir(), "polyon-domain-"));

    try {
      const first = new FileDomainStores(directory);

      first.missions.save({
        id: "mission-1",
        objective: "Persist POLYON state.",
        constraints: [],
        status: "DRAFT",
        taskIds: [],
        createdAt: "2026-09-27T04:00:00.000Z",
        updatedAt: "2026-09-27T04:00:00.000Z",
      });
      first.events.append({
        id: "event-1",
        kind: "MISSION_CREATED",
        missionId: "mission-1",
        occurredAt: "2026-09-27T04:00:00.000Z",
        data: {},
      });

      const second = new FileDomainStores(directory);

      expect(second.missions.get("mission-1")).toEqual(first.missions.get("mission-1"));
      expect(second.events.get("event-1")).toEqual(first.events.get("event-1"));
      expect(second.rootDir).toBe(directory);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("rejects a public direct write during a transaction", () => {
    const directory = mkdtempSync(join(tmpdir(), "polyon-domain-context-"));

    try {
      const stores = new FileDomainStores(directory);

      expect(() =>
        stores.transaction(({ missions }) => {
          missions.save({
            id: "mission-staged",
            objective: "Staged transaction write.",
            constraints: [],
            status: "DRAFT",
            taskIds: [],
            createdAt: "2026-09-28T00:00:00.000Z",
            updatedAt: "2026-09-28T00:00:00.000Z",
          });

          stores.missions.save({
            id: "mission-direct",
            objective: "Must not bypass transaction.",
            constraints: [],
            status: "DRAFT",
            taskIds: [],
            createdAt: "2026-09-28T00:00:00.000Z",
            updatedAt: "2026-09-28T00:00:00.000Z",
          });
        }),
      ).toThrow("A storage transaction is already in progress.");

      const reopened = new FileDomainStores(directory);
      expect(reopened.missions.get("mission-staged")).toBeUndefined();
      expect(reopened.missions.get("mission-direct")).toBeUndefined();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("commits writes from the transaction callback once", () => {
    const directory = mkdtempSync(join(tmpdir(), "polyon-domain-context-"));

    try {
      const stores = new FileDomainStores(directory);

      stores.transaction(({ missions, events }) => {
        missions.save({
          id: "mission-transaction-once",
          objective: "Write through the staged context.",
          constraints: [],
          status: "DRAFT",
          taskIds: [],
          createdAt: "2026-09-28T00:00:00.000Z",
          updatedAt: "2026-09-28T00:00:00.000Z",
        });
        events.append({
          id: "event-transaction-once",
          kind: "MISSION_CREATED",
          missionId: "mission-transaction-once",
          occurredAt: "2026-09-28T00:00:00.000Z",
          data: {},
        });
      });

      const reopened = new FileDomainStores(directory);
      expect(reopened.missions.get("mission-transaction-once")).toBeDefined();
      expect(reopened.events.get("event-transaction-once")).toBeDefined();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("commits mission and event changes as one durable transaction", () => {
    const directory = mkdtempSync(join(tmpdir(), "polyon-domain-"));

    try {
      const stores = new FileDomainStores(directory);

      stores.transaction(({ missions, events }) => {
        missions.save({
          id: "mission-1",
          objective: "Commit atomically.",
          constraints: [],
          status: "DRAFT",
          taskIds: [],
          createdAt: "2026-09-27T04:00:00.000Z",
          updatedAt: "2026-09-27T04:00:00.000Z",
        });
        events.append({
          id: "event-1",
          kind: "MISSION_CREATED",
          missionId: "mission-1",
          occurredAt: "2026-09-27T04:00:00.000Z",
          data: {},
        });
      });

      const reopened = new FileDomainStores(directory);

      expect(reopened.missions.get("mission-1")?.objective).toBe("Commit atomically.");
      expect(reopened.events.get("event-1")?.kind).toBe("MISSION_CREATED");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("rolls back the transaction when work throws", () => {
    const directory = mkdtempSync(join(tmpdir(), "polyon-domain-"));

    try {
      const stores = new FileDomainStores(directory);

      expect(() =>
        stores.transaction(({ missions, events }) => {
          missions.save({
            id: "mission-1",
            objective: "Should not persist.",
            constraints: [],
            status: "DRAFT",
            taskIds: [],
            createdAt: "2026-09-27T04:00:00.000Z",
            updatedAt: "2026-09-27T04:00:00.000Z",
          });
          events.append({
            id: "event-1",
            kind: "MISSION_CREATED",
            missionId: "mission-1",
            occurredAt: "2026-09-27T04:00:00.000Z",
            data: {},
          });
          throw new Error("transaction failed");
        }),
      ).toThrow("transaction failed");

      expect(new FileDomainStores(directory).missions.get("mission-1")).toBeUndefined();
      expect(new FileDomainStores(directory).events.get("event-1")).toBeUndefined();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("publishes newly committed domain events after transactions", () => {
    const directory = mkdtempSync(join(tmpdir(), "polyon-events-"));

    try {
      const stores = new FileDomainStores(directory);
      const events = [
        {
          id: "event-1",
          kind: "TASK_STATUS_CHANGED" as const,
          taskId: "task-1",
          occurredAt: "2026-09-29T10:00:00.000Z",
          data: { from: "PENDING", to: "RUNNING" },
        },
      ];
      const received: string[] = [];
      stores.subscribeCommittedEvents((event) => {
        received.push(event.id);
      });

      stores.transaction((context) => {
        for (const event of events) context.events.append(event);
      });

      expect(received).toEqual(["event-1"]);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("persists A2A push notification configurations across restart", () => {
    const directory = mkdtempSync(join(tmpdir(), "polyon-a2a-push-"));

    try {
      const first = new FileDomainStores(directory);
      first.a2aPushNotificationConfigs.save({
        id: "a2a-push:durable-1",
        ownerId: "actor-1",
        taskId: "task-1",
        url: "https://client.example.test/a2a/push",
        token: "token-1",
      });

      const reopened = new FileDomainStores(directory);

      expect(reopened.a2aPushNotificationConfigs.get("a2a-push:durable-1")).toEqual({
        id: "a2a-push:durable-1",
        ownerId: "actor-1",
        taskId: "task-1",
        url: "https://client.example.test/a2a/push",
        token: "token-1",
      });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("keeps domain stores on the existing replaceable interfaces", () => {
    const directory = mkdtempSync(join(tmpdir(), "polyon-domain-"));

    try {
      const stores = new FileDomainStores(directory);

      stores.tasks.save({
        id: "task-1",
        missionId: "mission-1",
        kind: "CODING",
        title: "Durable task",
        description: "Stored on disk.",
        status: "PENDING",
        dependsOn: [],
        createdAt: "2026-09-27T04:00:00.000Z",
        updatedAt: "2026-09-27T04:00:00.000Z",
      });

      expect(stores.tasks.list().map((task) => task.id)).toEqual(["task-1"]);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
