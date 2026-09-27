import { InMemoryDomainStores, InMemoryEventStore } from "@polyon/storage";
import { describe, expect, it } from "vitest";

import { MissionCreationService, MissionCreationServiceError } from "./mission-creation-service";

const missionConversation = {
  id: "conversation-1",
  kind: "MISSION" as const,
  status: "ACTIVE" as const,
  participantIds: ["user-1"],
  messageIds: ["message-1"],
  createdAt: "2026-09-27T02:00:00.000Z",
  updatedAt: "2026-09-27T02:01:00.000Z",
};

const serviceDependencies = () => {
  const stores = new InMemoryDomainStores();
  const events = new InMemoryEventStore();

  stores.conversations.save(missionConversation);

  return {
    stores,
    events,
    service: new MissionCreationService({
      conversations: stores.conversations,
      missions: stores.missions,
      events,
    }),
  };
};

describe("MissionCreationService", () => {
  it("persists a draft mission, binds the conversation, and emits a traceable creation event", () => {
    const { stores, events, service } = serviceDependencies();

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
    expect(result.conversation).toEqual({
      ...missionConversation,
      missionId: "mission-1",
      updatedAt: "2026-09-27T02:10:00.000Z",
    });
    expect(stores.missions.get("mission-1")).toEqual(result.mission);
    expect(stores.conversations.get("conversation-1")).toEqual(result.conversation);
    expect(result.event).toEqual({
      id: "event-mission-created-1",
      kind: "MISSION_CREATED",
      actorId: "user-1",
      conversationId: "conversation-1",
      missionId: "mission-1",
      occurredAt: "2026-09-27T02:10:00.000Z",
      data: {
        conversationId: "conversation-1",
        missionId: "mission-1",
        objective: "Build the POLYON planning flow.",
        status: "DRAFT",
        taskCount: 0,
      },
    });
    expect(events.listByMission("mission-1")).toEqual([result.event]);
  });

  it("rejects creation when the conversation does not exist", () => {
    const stores = new InMemoryDomainStores();
    const events = new InMemoryEventStore();
    const service = new MissionCreationService({
      conversations: stores.conversations,
      missions: stores.missions,
      events,
    });

    expect(() =>
      service.create({
        id: "mission-1",
        objective: "New mission",
        actorId: "user-1",
        eventId: "event-1",
        conversationId: "missing-conversation",
        createdAt: "2026-09-27T02:11:00.000Z",
      }),
    ).toThrowError(
      new MissionCreationServiceError(
        "CONVERSATION_NOT_FOUND",
        "Conversation not found: missing-conversation.",
      ),
    );

    expect(stores.missions.get("mission-1")).toBeUndefined();
    expect(events.list()).toEqual([]);
  });

  it("rejects non-mission conversations", () => {
    const { stores, events } = serviceDependencies();
    stores.conversations.save({
      ...missionConversation,
      kind: "DIRECT",
    });

    const service = new MissionCreationService({
      conversations: stores.conversations,
      missions: stores.missions,
      events,
    });

    expect(() =>
      service.create({
        id: "mission-1",
        objective: "New mission",
        actorId: "user-1",
        eventId: "event-1",
        conversationId: "conversation-1",
        createdAt: "2026-09-27T02:11:00.000Z",
      }),
    ).toThrowError(MissionCreationServiceError);

    expect(stores.missions.get("mission-1")).toBeUndefined();
    expect(events.list()).toEqual([]);
  });

  it("rejects a conversation that is already bound to a mission", () => {
    const { stores, events } = serviceDependencies();
    stores.conversations.save({
      ...missionConversation,
      missionId: "existing-mission",
    });

    const service = new MissionCreationService({
      conversations: stores.conversations,
      missions: stores.missions,
      events,
    });

    expect(() =>
      service.create({
        id: "mission-1",
        objective: "New mission",
        actorId: "user-1",
        eventId: "event-1",
        conversationId: "conversation-1",
        createdAt: "2026-09-27T02:11:00.000Z",
      }),
    ).toThrowError(
      new MissionCreationServiceError(
        "CONVERSATION_ALREADY_BOUND",
        "Conversation conversation-1 is already bound to mission existing-mission.",
      ),
    );

    expect(stores.missions.get("mission-1")).toBeUndefined();
    expect(events.list()).toEqual([]);
  });

  it("fails before writing when the mission ID already exists", () => {
    const { stores, events, service } = serviceDependencies();
    stores.missions.save({
      id: "mission-1",
      objective: "Existing mission",
      constraints: [],
      status: "DRAFT",
      taskIds: [],
      createdAt: "2026-09-27T02:00:00.000Z",
      updatedAt: "2026-09-27T02:00:00.000Z",
    });

    expect(() =>
      service.create({
        id: "mission-1",
        objective: "New mission",
        actorId: "user-1",
        eventId: "event-1",
        conversationId: "conversation-1",
        createdAt: "2026-09-27T02:11:00.000Z",
      }),
    ).toThrowError(MissionCreationServiceError);

    expect(events.list()).toEqual([]);
    expect(stores.conversations.get("conversation-1")).toEqual(missionConversation);
    expect(stores.missions.get("mission-1")?.objective).toBe("Existing mission");
  });

  it("fails before writing when the event ID already exists", () => {
    const { stores, events, service } = serviceDependencies();
    events.append({
      id: "event-1",
      kind: "OTHER",
      occurredAt: "2026-09-27T02:00:00.000Z",
      data: {},
    });

    expect(() =>
      service.create({
        id: "mission-1",
        objective: "New mission",
        actorId: "user-1",
        eventId: "event-1",
        conversationId: "conversation-1",
        createdAt: "2026-09-27T02:11:00.000Z",
      }),
    ).toThrowError(MissionCreationServiceError);

    expect(stores.missions.get("mission-1")).toBeUndefined();
    expect(stores.conversations.get("conversation-1")).toEqual(missionConversation);
    expect(events.list()).toHaveLength(1);
  });

  it("propagates domain validation before writing anything", () => {
    const { stores, events, service } = serviceDependencies();

    expect(() =>
      service.create({
        id: "mission-1",
        objective: "   ",
        actorId: "user-1",
        eventId: "event-1",
        conversationId: "conversation-1",
        createdAt: "2026-09-27T02:11:00.000Z",
      }),
    ).toThrow();

    expect(stores.missions.get("mission-1")).toBeUndefined();
    expect(stores.conversations.get("conversation-1")).toEqual(missionConversation);
    expect(events.list()).toEqual([]);
  });
});
