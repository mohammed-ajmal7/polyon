import type { Conversation } from "@polyon/contracts";
import { describe, expect, it } from "vitest";

import { CommandIngressError, CommandIngressService } from "./command-ingress";
import { InMemoryDomainStores, InMemoryEventStore } from "@polyon/storage";

const dependencies = () => {
  const stores = new InMemoryDomainStores();
  const events = new InMemoryEventStore();

  return {
    stores,
    events,
    service: new CommandIngressService({
      conversations: stores.conversations,
      messages: stores.messages,
      events,
    }),
  };
};

const createdAt = "2026-09-27T01:10:00.000Z";

describe("CommandIngressService", () => {
  it("runs conversation, message, and event persistence through the supplied unit of work", () => {
    const stores = new InMemoryDomainStores();
    let transactionCalls = 0;

    const unitOfWork = {
      transaction<T>(work: Parameters<InMemoryDomainStores["transaction"]>[0]): T {
        transactionCalls += 1;
        return stores.transaction(work) as T;
      },
    };

    const service = new CommandIngressService({
      conversations: stores.conversations,
      messages: stores.messages,
      events: stores.events,
      unitOfWork,
    });

    const result = service.submit({
      mode: "Mission",
      command: "Create transactionally.",
      actorId: "user-1",
      conversationId: "conversation-transaction-1",
      messageId: "message-transaction-1",
      eventId: "event-transaction-1",
      participantIds: ["user-1"],
      createdAt,
    });

    expect(transactionCalls).toBe(1);
    expect(stores.conversations.get("conversation-transaction-1")).toEqual(result.conversation);
    expect(stores.messages.get("message-transaction-1")).toEqual(result.message);
    expect(stores.events.get("event-transaction-1")).toEqual(result.event);
  });

  it("creates a conversation, persists the user message, and records a trace event", () => {
    const { stores, events, service } = dependencies();

    const result = service.submit({
      mode: "Mission",
      command: "  Build the execution spine.  ",
      actorId: "user-1",
      conversationId: "conversation-1",
      messageId: "message-1",
      eventId: "event-1",
      participantIds: ["agent-1", "user-1"],
      missionId: "mission-1",
      createdAt,
    });

    expect(result.conversation).toEqual({
      id: "conversation-1",
      kind: "MISSION",
      status: "ACTIVE",
      participantIds: ["agent-1", "user-1"],
      messageIds: ["message-1"],
      missionId: "mission-1",
      createdAt,
      updatedAt: createdAt,
    });
    expect(result.message.content).toBe("Build the execution spine.");
    expect(result.event).toEqual({
      id: "event-1",
      kind: "MESSAGE_CREATED",
      actorId: "user-1",
      conversationId: "conversation-1",
      missionId: "mission-1",
      occurredAt: createdAt,
      data: {
        conversationId: "conversation-1",
        messageId: "message-1",
        mode: "MISSION",
      },
    });
    expect(stores.messages.get("message-1")).toEqual(result.message);
    expect(stores.conversations.get("conversation-1")).toEqual(result.conversation);
    expect(events.get("event-1")).toEqual(result.event);
  });

  it("appends a later command without replacing the conversation snapshot", () => {
    const { stores, service } = dependencies();

    const existing: Conversation = {
      id: "conversation-1",
      kind: "DIRECT",
      status: "ACTIVE",
      participantIds: ["user-1"],
      messageIds: ["message-1"],
      createdAt: "2026-09-27T01:00:00.000Z",
      updatedAt: "2026-09-27T01:01:00.000Z",
    };

    stores.conversations.save(existing);
    stores.messages.save({
      id: "message-1",
      conversationId: existing.id,
      actorId: "user-1",
      role: "USER",
      kind: "TEXT",
      content: "First command",
      createdAt: existing.updatedAt,
    });

    const result = service.submit({
      mode: "Direct",
      command: "Second command",
      actorId: "user-1",
      conversationId: existing.id,
      messageId: "message-2",
      eventId: "event-2",
      createdAt,
    });

    expect(result.conversation.messageIds).toEqual(["message-1", "message-2"]);
    expect(result.conversation.createdAt).toBe(existing.createdAt);
    expect(result.conversation.updatedAt).toBe(createdAt);
    expect(stores.conversations.get(existing.id)?.messageIds).toEqual(["message-1", "message-2"]);
  });

  it("rejects commands from actors outside the conversation", () => {
    const { stores, service } = dependencies();

    stores.conversations.save({
      id: "conversation-1",
      kind: "DIRECT",
      status: "ACTIVE",
      participantIds: ["user-1"],
      messageIds: [],
      createdAt,
      updatedAt: createdAt,
    });

    expect(() =>
      service.submit({
        mode: "Direct",
        command: "Do something.",
        actorId: "user-2",
        conversationId: "conversation-1",
        messageId: "message-1",
        eventId: "event-1",
        createdAt,
      }),
    ).toThrowError(
      new CommandIngressError(
        "ACTOR_NOT_PARTICIPANT",
        "The submitting actor is not a participant in this conversation.",
      ),
    );
  });

  it("creates a deep analysis conversation kind", () => {
    const { stores, service } = dependencies();

    const result = service.submit({
      mode: "DeepAnalysis",
      command: "Investigate this deeply.",
      actorId: "user-1",
      conversationId: "conversation-deep-analysis",
      messageId: "message-deep-analysis",
      eventId: "event-deep-analysis",
      participantIds: ["user-1", "agent-a", "agent-b"],
      createdAt,
    });

    expect(result.conversation.kind).toBe("DEEP_ANALYSIS");
    expect(result.event.data.mode).toBe("DEEP_ANALYSIS");
    expect(stores.conversations.get("conversation-deep-analysis")).toEqual(result.conversation);
  });

  it("creates a research conversation kind", () => {
    const { service } = dependencies();

    const result = service.submit({
      mode: "Research",
      command: "Research this question.",
      actorId: "user-1",
      conversationId: "conversation-research",
      messageId: "message-research",
      eventId: "event-research",
      participantIds: ["user-1", "researcher"],
      createdAt,
    });

    expect(result.conversation.kind).toBe("RESEARCH");
    expect(result.event.data.mode).toBe("RESEARCH");
  });

  it("rejects a mode that does not match the conversation kind", () => {
    const { stores, service } = dependencies();

    stores.conversations.save({
      id: "conversation-1",
      kind: "DEBATE",
      status: "ACTIVE",
      participantIds: ["user-1"],
      messageIds: [],
      createdAt,
      updatedAt: createdAt,
    });

    expect(() =>
      service.submit({
        mode: "Mission",
        command: "Continue.",
        actorId: "user-1",
        conversationId: "conversation-1",
        messageId: "message-1",
        eventId: "event-1",
        createdAt,
      }),
    ).toThrowError(
      new CommandIngressError(
        "CONVERSATION_KIND_MISMATCH",
        "Conversation conversation-1 is DEBATE, not MISSION.",
      ),
    );
  });

  it("rejects an empty command before writing anything", () => {
    const { stores, events, service } = dependencies();

    expect(() =>
      service.submit({
        mode: "Direct",
        command: "   ",
        actorId: "user-1",
        conversationId: "conversation-1",
        messageId: "message-1",
        eventId: "event-1",
        participantIds: ["user-1"],
        createdAt,
      }),
    ).toThrowError(new CommandIngressError("COMMAND_REQUIRED", "A command is required."));

    expect(stores.conversations.get("conversation-1")).toBeUndefined();
    expect(stores.messages.get("message-1")).toBeUndefined();
    expect(events.get("event-1")).toBeUndefined();
  });

  it("rejects duplicate message or event identities before changing the conversation", () => {
    const { stores, events, service } = dependencies();

    stores.conversations.save({
      id: "conversation-1",
      kind: "DIRECT",
      status: "ACTIVE",
      participantIds: ["user-1"],
      messageIds: ["message-1"],
      createdAt,
      updatedAt: createdAt,
    });
    stores.messages.save({
      id: "message-1",
      conversationId: "conversation-1",
      actorId: "user-1",
      role: "USER",
      kind: "TEXT",
      content: "Existing",
      createdAt,
    });

    expect(() =>
      service.submit({
        mode: "Direct",
        command: "Duplicate message.",
        actorId: "user-1",
        conversationId: "conversation-1",
        messageId: "message-1",
        eventId: "event-1",
        createdAt,
      }),
    ).toThrowError(
      new CommandIngressError("DUPLICATE_MESSAGE", "Message already exists: message-1."),
    );

    events.append({
      id: "event-1",
      kind: "OTHER",
      occurredAt: createdAt,
      data: {},
    });

    expect(() =>
      service.submit({
        mode: "Direct",
        command: "Duplicate event.",
        actorId: "user-1",
        conversationId: "conversation-1",
        messageId: "message-2",
        eventId: "event-1",
        createdAt,
      }),
    ).toThrowError(new CommandIngressError("DUPLICATE_EVENT", "Event already exists: event-1."));

    expect(stores.conversations.get("conversation-1")?.messageIds).toEqual(["message-1"]);
  });
});
