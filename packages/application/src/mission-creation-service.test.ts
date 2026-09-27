import { InMemoryDomainStores, InMemoryEventStore } from "@polyon/storage";
import { describe, expect, it } from "vitest";

import { MissionCreationService, MissionCreationServiceError } from "./mission-creation-service";

describe("MissionCreationService", () => {
  it("persists a draft mission and emits a traceable creation event", () => {
    const stores = new InMemoryDomainStores();
    const events = new InMemoryEventStore();
    const service = new MissionCreationService({
      missions: stores.missions,
      events,
    });

    const result = service.create({
      id: "mission-1",
      objective: "Build the POLYON planning flow.",
      constraints: ["Human approval is required for consequential actions."],
      actorId: "user-1",
      eventId: "event-mission-created-1",
      conversationId: "conversation-1",
      createdAt: "2026-09-27T02:10:00.000Z",
    });

    expect(result.mission).toEqual({
      id: "mission-1",
      objective: "Build the POLYON planning flow.",
      constraints: ["Human approval is required for consequential actions."],
      status: "DRAFT",
      taskIds: [],
      createdAt: "2026-09-27T02:10:00.000Z",
      updatedAt: "2026-09-27T02:10:00.000Z",
    });
    expect(stores.missions.get("mission-1")).toEqual(result.mission);
    expect(result.event).toEqual({
      id: "event-mission-created-1",
      kind: "MISSION_CREATED",
      actorId: "user-1",
      conversationId: "conversation-1",
      missionId: "mission-1",
      occurredAt: "2026-09-27T02:10:00.000Z",
      data: {
        missionId: "mission-1",
        objective: "Build the POLYON planning flow.",
        status: "DRAFT",
        taskCount: 0,
      },
    });
    expect(events.listByMission("mission-1")).toEqual([result.event]);
  });

  it("fails before writing when the mission ID already exists", () => {
    const stores = new InMemoryDomainStores();
    const events = new InMemoryEventStore();
    stores.missions.save({
      id: "mission-1",
      objective: "Existing mission",
      constraints: [],
      status: "DRAFT",
      taskIds: [],
      createdAt: "2026-09-27T02:00:00.000Z",
      updatedAt: "2026-09-27T02:00:00.000Z",
    });

    const service = new MissionCreationService({
      missions: stores.missions,
      events,
    });

    expect(() =>
      service.create({
        id: "mission-1",
        objective: "New mission",
        actorId: "user-1",
        eventId: "event-1",
        createdAt: "2026-09-27T02:11:00.000Z",
      }),
    ).toThrowError(MissionCreationServiceError);

    expect(events.list()).toEqual([]);
    expect(stores.missions.get("mission-1")?.objective).toBe("Existing mission");
  });

  it("fails before writing when the event ID already exists", () => {
    const stores = new InMemoryDomainStores();
    const events = new InMemoryEventStore();
    events.append({
      id: "event-1",
      kind: "OTHER",
      occurredAt: "2026-09-27T02:00:00.000Z",
      data: {},
    });

    const service = new MissionCreationService({
      missions: stores.missions,
      events,
    });

    expect(() =>
      service.create({
        id: "mission-1",
        objective: "New mission",
        actorId: "user-1",
        eventId: "event-1",
        createdAt: "2026-09-27T02:11:00.000Z",
      }),
    ).toThrowError(MissionCreationServiceError);

    expect(stores.missions.get("mission-1")).toBeUndefined();
    expect(events.list()).toHaveLength(1);
  });
});
