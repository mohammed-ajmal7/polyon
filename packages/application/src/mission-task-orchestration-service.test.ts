import type { Task } from "@polyon/contracts";
import { InMemoryDomainStores } from "@polyon/storage";
import { describe, expect, it } from "vitest";

import { MissionTaskOrchestrationService } from "./mission-task-orchestration-service";

const actorId = "actor-1" as const;

function task(id: string, status: Task["status"], dependsOn: readonly string[] = []): Task {
  return {
    id,
    missionId: "mission-1",
    kind: "ANALYSIS",
    title: id,
    description: id,
    status,
    dependsOn,
    createdAt: "2026-09-27T00:00:00.000Z",
    updatedAt: "2026-09-27T00:00:00.000Z",
  };
}

describe("MissionTaskOrchestrationService", () => {
  it("marks root tasks ready and leaves dependent tasks blocked", () => {
    const stores = new InMemoryDomainStores();
    stores.tasks.save(task("task-1", "PENDING"));
    stores.tasks.save(task("task-2", "PENDING", ["task-1"]));

    const result = new MissionTaskOrchestrationService(stores).advanceReadyTasks({
      missionId: "mission-1",
      actorId,
      now: "2026-09-27T01:00:00.000Z",
    });

    expect(result.changed.map((item) => item.id)).toEqual(["task-1"]);
    expect(result.changed[0]?.status).toBe("READY");
    expect(result.blocked.map((item) => item.id)).toEqual(["task-2"]);
    expect(stores.events.list()).toHaveLength(1);
  });

  it("unblocks dependents after a successful dependency", () => {
    const stores = new InMemoryDomainStores();
    stores.tasks.save(task("task-1", "SUCCEEDED"));
    stores.tasks.save(task("task-2", "BLOCKED", ["task-1"]));
    stores.tasks.save(task("task-3", "PENDING", ["task-2"]));

    const result = new MissionTaskOrchestrationService(stores).advanceReadyTasks({
      missionId: "mission-1",
      actorId,
      now: "2026-09-27T01:00:00.000Z",
    });

    expect(result.changed.map((item) => item.id)).toEqual(["task-2"]);
    expect(result.blocked.map((item) => item.id)).toEqual(["task-3"]);
  });

  it("hands newly ready tasks to the configured application dispatcher", () => {
    const stores = new InMemoryDomainStores();
    stores.tasks.save(task("task-1", "SUCCEEDED"));
    stores.tasks.save(task("task-2", "BLOCKED", ["task-1"]));

    let received: readonly Task[] = [];
    const service = new MissionTaskOrchestrationService({
      tasks: stores.tasks,
      events: stores.events,
      onReadyTasks: (result) => {
        received = result.changed;
      },
    });

    service.advanceReadyTasks({
      missionId: "mission-1",
      actorId,
      now: "2026-09-27T01:00:00.000Z",
    });

    expect(received.map((item) => item.id)).toEqual(["task-2"]);
    expect(stores.tasks.get("task-2")?.status).toBe("READY");
  });

  it("is idempotent once tasks are already ready", () => {
    const stores = new InMemoryDomainStores();
    stores.tasks.save(task("task-1", "READY"));

    const result = new MissionTaskOrchestrationService(stores).advanceReadyTasks({
      missionId: "mission-1",
      actorId,
      now: "2026-09-27T01:00:00.000Z",
    });

    expect(result.changed).toHaveLength(0);
    expect(stores.events.list()).toHaveLength(0);
  });

  it("uses the domain transaction boundary when supplied", () => {
    const stores = new InMemoryDomainStores();
    stores.tasks.save(task("task-1", "PENDING"));

    const result = new MissionTaskOrchestrationService({
      tasks: stores.tasks,
      events: stores.events,
      unitOfWork: stores,
    }).advanceReadyTasks({
      missionId: "mission-1",
      actorId,
      now: "2026-09-27T01:00:00.000Z",
    });

    expect(result.changed[0]?.status).toBe("READY");
    expect(stores.events.list()).toHaveLength(1);
  });
});
