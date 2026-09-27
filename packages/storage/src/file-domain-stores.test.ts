import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";

import { FileDomainStores } from "./file-domain-stores";

describe("FileDomainStores", () => {
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
