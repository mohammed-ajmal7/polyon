import type { Mission, Task } from "@polyon/contracts";
import { InMemoryDomainStores, InMemoryEventStore } from "@polyon/storage";
import { describe, expect, it } from "vitest";

import { MissionLifecycleService, MissionLifecycleServiceError } from "./mission-lifecycle-service";

const baseMission: Mission = {
  id: "mission-1",
  objective: "Build POLYON",
  constraints: [],
  status: "DRAFT",
  taskIds: ["task-1", "task-2"],
  createdAt: "2026-09-27T03:00:00.000Z",
  updatedAt: "2026-09-27T03:00:00.000Z",
};

function createTask(
  id: string,
  status: Task["status"] = "PENDING",
  dependsOn: readonly string[] = [],
): Task {
  return {
    id,
    missionId: "mission-1",
    kind: "CODING",
    title: id,
    description: `Task ${id}`,
    status,
    dependsOn,
    createdAt: "2026-09-27T03:00:00.000Z",
    updatedAt: "2026-09-27T03:00:00.000Z",
  };
}

function createService(
  mission: Mission = baseMission,
  tasks: readonly Task[] = [createTask("task-1"), createTask("task-2")],
) {
  const stores = new InMemoryDomainStores();
  const events = new InMemoryEventStore();

  stores.missions.save(mission);
  for (const task of tasks) {
    stores.tasks.save(task);
  }

  return {
    stores,
    events,
    service: new MissionLifecycleService({
      missions: stores.missions,
      tasks: stores.tasks,
      events,
    }),
  };
}

describe("MissionLifecycleService", () => {
  it("runs mission status and event persistence through the supplied unit of work", () => {
    const stores = new InMemoryDomainStores();
    stores.missions.save(baseMission);
    let transactionCalls = 0;

    const unitOfWork = {
      transaction<T>(work: Parameters<InMemoryDomainStores["transaction"]>[0]): T {
        transactionCalls += 1;
        return stores.transaction(work) as T;
      },
    };

    const service = new MissionLifecycleService({
      missions: stores.missions,
      tasks: stores.tasks,
      events: stores.events,
      unitOfWork,
    });

    const result = service.transition({
      missionId: "mission-1",
      to: "PLANNING",
      actorId: "user-1",
      eventId: "mission-status-transaction-1",
      now: "2026-09-27T03:05:00.000Z",
    });

    expect(transactionCalls).toBe(1);
    expect(stores.missions.get("mission-1")).toEqual(result.mission);
    expect(stores.events.get("mission-status-transaction-1")).toEqual(result.event);
  });

  it("transitions a draft mission to planning and emits a traceable event", () => {
    const { stores, events, service } = createService();

    const result = service.transition({
      missionId: "mission-1",
      to: "PLANNING",
      actorId: "user-1",
      eventId: "mission-status-1",
      now: "2026-09-27T03:05:00.000Z",
    });

    expect(result.mission.status).toBe("PLANNING");
    expect(stores.missions.get("mission-1")?.status).toBe("PLANNING");
    expect(result.event).toEqual({
      id: "mission-status-1",
      kind: "MISSION_STATUS_CHANGED",
      actorId: "user-1",
      missionId: "mission-1",
      occurredAt: "2026-09-27T03:05:00.000Z",
      data: {
        from: "DRAFT",
        to: "PLANNING",
      },
    });
    expect(events.listByMission("mission-1")).toEqual([result.event]);
  });

  it("links a mission status transition to the event that caused it", () => {
    const { service } = createService({
      ...baseMission,
      status: "PLANNING",
    });

    const result = service.transition({
      missionId: "mission-1",
      to: "RUNNING",
      actorId: "user-1",
      eventId: "mission-status-2",
      now: "2026-09-27T03:06:00.000Z",
      causedByEventId: "TASK_STATUS_CHANGED:task-1:PENDING:APPROVED:2026-09-27T03:05:00.000Z",
    });

    expect(result.event.causedByEventId).toBe(
      "TASK_STATUS_CHANGED:task-1:PENDING:APPROVED:2026-09-27T03:05:00.000Z",
    );
  });

  it("rejects an unknown mission before writing anything", () => {
    const { stores, events, service } = createService();
    stores.missions.delete("mission-1");

    expect(() =>
      service.transition({
        missionId: "missing",
        to: "PLANNING",
        actorId: "user-1",
        eventId: "mission-status-3",
        now: "2026-09-27T03:05:00.000Z",
      }),
    ).toThrowError(
      new MissionLifecycleServiceError("MISSION_NOT_FOUND", "Mission not found: missing."),
    );

    expect(events.list()).toEqual([]);
    expect(stores.missions.list()).toEqual([]);
  });

  it("rejects a duplicate event identity before changing the mission", () => {
    const { stores, events, service } = createService();

    events.append({
      id: "mission-status-4",
      kind: "OTHER",
      occurredAt: "2026-09-27T03:04:00.000Z",
      data: {},
    });

    expect(() =>
      service.transition({
        missionId: "mission-1",
        to: "PLANNING",
        actorId: "user-1",
        eventId: "mission-status-4",
        now: "2026-09-27T03:05:00.000Z",
      }),
    ).toThrowError(
      new MissionLifecycleServiceError(
        "EVENT_EXISTS",
        "Mission status event already exists: mission-status-4.",
      ),
    );

    expect(stores.missions.get("mission-1")?.status).toBe("DRAFT");
    expect(events.list()).toHaveLength(1);
  });

  it("uses the domain state machine for invalid transitions", () => {
    const { stores, events, service } = createService({
      ...baseMission,
      status: "SUCCEEDED",
    });

    expect(() =>
      service.transition({
        missionId: "mission-1",
        to: "RUNNING",
        actorId: "user-1",
        eventId: "mission-status-5",
        now: "2026-09-27T03:05:00.000Z",
      }),
    ).toThrow();

    expect(stores.missions.get("mission-1")?.status).toBe("SUCCEEDED");
    expect(events.list()).toEqual([]);
  });

  it("keeps planning state while tasks have not entered execution", () => {
    const { stores, events, service } = createService({
      ...baseMission,
      status: "PLANNING",
    });

    const result = service.syncProgress({
      missionId: "mission-1",
      actorId: "user-1",
      eventId: "mission-status-6",
      now: "2026-09-27T03:10:00.000Z",
    });

    expect(result).toEqual({
      changed: false,
      mission: stores.missions.get("mission-1"),
    });
    expect(events.list()).toEqual([]);
  });

  it("moves planning to running when a task is approved for execution", () => {
    const { service, events } = createService(
      {
        ...baseMission,
        status: "PLANNING",
      },
      [createTask("task-1", "APPROVED"), createTask("task-2", "PENDING")],
    );

    const result = service.syncProgress({
      missionId: "mission-1",
      actorId: "user-1",
      eventId: "mission-status-7",
      now: "2026-09-27T03:11:00.000Z",
    });

    expect(result.changed).toBe(true);
    expect(result.mission.status).toBe("RUNNING");
    expect(result.event?.data).toEqual({
      from: "PLANNING",
      to: "RUNNING",
    });
    expect(events.listByMission("mission-1")).toHaveLength(1);
  });

  it("moves planning to waiting when a task requires approval", () => {
    const { service } = createService(
      {
        ...baseMission,
        status: "PLANNING",
      },
      [createTask("task-1", "APPROVAL_REQUIRED"), createTask("task-2", "PENDING")],
    );

    const result = service.syncProgress({
      missionId: "mission-1",
      actorId: "user-1",
      eventId: "mission-status-8",
      now: "2026-09-27T03:12:00.000Z",
    });

    expect(result.mission.status).toBe("WAITING");
  });

  it("moves a waiting mission back to running after approval", () => {
    const { service } = createService(
      {
        ...baseMission,
        status: "WAITING",
      },
      [createTask("task-1", "APPROVED"), createTask("task-2", "APPROVAL_REQUIRED")],
    );

    const result = service.syncProgress({
      missionId: "mission-1",
      actorId: "user-1",
      eventId: "mission-status-9",
      now: "2026-09-27T03:13:00.000Z",
    });

    expect(result.mission.status).toBe("RUNNING");
  });

  it("moves a running mission to succeeded only when every task succeeds", () => {
    const { service } = createService(
      {
        ...baseMission,
        status: "RUNNING",
      },
      [createTask("task-1", "SUCCEEDED"), createTask("task-2", "SUCCEEDED")],
    );

    const result = service.syncProgress({
      missionId: "mission-1",
      actorId: "system-1",
      eventId: "mission-status-10",
      now: "2026-09-27T03:14:00.000Z",
    });

    expect(result.mission.status).toBe("SUCCEEDED");
    expect(result.event?.data).toEqual({
      from: "RUNNING",
      to: "SUCCEEDED",
    });
  });

  it("keeps a mission retryable after a task fails", () => {
    const { service } = createService(
      {
        ...baseMission,
        status: "RUNNING",
      },
      [createTask("task-1", "FAILED"), createTask("task-2", "SUCCEEDED")],
    );

    const result = service.syncProgress({
      missionId: "mission-1",
      actorId: "system-1",
      eventId: "mission-status-11",
      now: "2026-09-27T03:15:00.000Z",
    });

    expect(result.mission.status).toBe("WAITING");
    expect(result.mission.status).not.toBe("FAILED");
  });

  it("fails a mission when a task is rejected", () => {
    const { service } = createService(
      {
        ...baseMission,
        status: "RUNNING",
      },
      [createTask("task-1", "REJECTED"), createTask("task-2", "SUCCEEDED")],
    );

    const result = service.syncProgress({
      missionId: "mission-1",
      actorId: "system-1",
      eventId: "mission-status-12",
      now: "2026-09-27T03:16:00.000Z",
    });

    expect(result.mission.status).toBe("FAILED");
  });

  it("cancels a mission when a task is cancelled", () => {
    const { service } = createService(
      {
        ...baseMission,
        status: "RUNNING",
      },
      [createTask("task-1", "CANCELLED"), createTask("task-2", "SUCCEEDED")],
    );

    const result = service.syncProgress({
      missionId: "mission-1",
      actorId: "system-1",
      eventId: "mission-status-13",
      now: "2026-09-27T03:17:00.000Z",
    });

    expect(result.mission.status).toBe("CANCELLED");
  });

  it("does not reopen a terminal mission during a stale progress sync", () => {
    const { service, stores, events } = createService(
      {
        ...baseMission,
        status: "FAILED",
      },
      [createTask("task-1", "SUCCEEDED"), createTask("task-2", "SUCCEEDED")],
    );

    const result = service.syncProgress({
      missionId: "mission-1",
      actorId: "system-1",
      eventId: "mission-status-14",
      now: "2026-09-27T03:18:00.000Z",
    });

    expect(result).toEqual({
      changed: false,
      mission: stores.missions.get("mission-1"),
    });
    expect(events.list()).toEqual([]);
  });

  it("rejects a mission task that is missing from persistence", () => {
    const { stores, service } = createService(
      {
        ...baseMission,
        status: "RUNNING",
        taskIds: ["missing-task"],
      },
      [],
    );

    expect(() =>
      service.syncProgress({
        missionId: "mission-1",
        actorId: "system-1",
        eventId: "mission-status-15",
        now: "2026-09-27T03:19:00.000Z",
      }),
    ).toThrowError(
      new MissionLifecycleServiceError(
        "TASK_NOT_FOUND",
        "Mission mission-1 references a task that is not persisted: missing-task.",
      ),
    );
  });

  it("rejects a task that is persisted under a different mission", () => {
    const { service } = createService(
      {
        ...baseMission,
        status: "RUNNING",
      },
      [
        {
          ...createTask("task-1", "SUCCEEDED"),
          missionId: "mission-2",
        },
        createTask("task-2", "SUCCEEDED"),
      ],
    );

    expect(() =>
      service.syncProgress({
        missionId: "mission-1",
        actorId: "system-1",
        eventId: "mission-status-16",
        now: "2026-09-27T03:20:00.000Z",
      }),
    ).toThrowError(
      new MissionLifecycleServiceError(
        "TASK_MISSION_MISMATCH",
        "Task task-1 belongs to mission mission-2, not mission mission-1.",
      ),
    );
  });

  it("does not emit when progress produces no transition", () => {
    const { service, events } = createService(
      {
        ...baseMission,
        status: "PLANNING",
        taskIds: [],
      },
      [],
    );

    const result = service.syncProgress({
      missionId: "mission-1",
      actorId: "system-1",
      eventId: "unused",
      now: "2026-09-27T03:21:00.000Z",
    });

    expect(result.changed).toBe(false);
    expect(events.list()).toEqual([]);
  });
});
