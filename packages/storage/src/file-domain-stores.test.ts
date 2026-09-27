/// <reference path="./node-runtime.d.ts" />

import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";

import { FileDomainStores } from "./file-domain-stores";
import { InMemoryDomainStores } from "./domain-stores";

describe("InMemoryDomainStores", () => {
  it("rejects nested transactions", () => {
    const stores = new InMemoryDomainStores();

    expect(() =>
      stores.transaction(() => stores.transaction(() => undefined)),
    ).toThrow("A storage transaction is already in progress.");
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

      expect(() =>
        stores.transaction(() => stores.transaction(() => undefined)),
      ).toThrow("A storage transaction is already in progress.");
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

      expect(reopened.missions.get("mission-1")?.objective).toBe(
        "Newer state.",
      );
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
      expect(reopened.missions.get("mission-concurrent-1")?.objective).toBe(
        "Concurrent write.",
      );
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

      expect(reopened.missions.get("mission-1")?.objective).toBe(
        "Commit atomically.",
      );
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

