import type { Conversation } from "@polyon/contracts";
import { describe, expect, it } from "vitest";

import { ConversationQueryError, ConversationQueryService } from "./conversation-query";
import { InMemoryDomainStores, InMemoryEventStore } from "@polyon/storage";

const conversation: Conversation = {
  id: "conversation-1",
  kind: "MISSION",
  status: "ACTIVE",
  participantIds: ["user-1", "agent-1"],
  messageIds: ["message-1"],
  missionId: "mission-1",
  createdAt: "2026-09-27T01:00:00.000Z",
  updatedAt: "2026-09-27T01:02:00.000Z",
};

describe("ConversationQueryService", () => {
  it("returns a conversation with ordered messages and scoped events", () => {
    const stores = new InMemoryDomainStores();
    const events = new InMemoryEventStore();

    stores.conversations.save(conversation);
    stores.messages.save({
      id: "message-1",
      conversationId: conversation.id,
      actorId: "user-1",
      role: "USER",
      kind: "TEXT",
      content: "Build POLYON.",
      createdAt: "2026-09-27T01:01:00.000Z",
    });
    events.append({
      id: "event-1",
      kind: "MESSAGE_CREATED",
      actorId: "user-1",
      conversationId: conversation.id,
      missionId: conversation.missionId,
      occurredAt: "2026-09-27T01:01:00.000Z",
      data: {
        conversationId: conversation.id,
        messageId: "message-1",
      },
    });

    const service = new ConversationQueryService({
      conversations: stores.conversations,
      messages: stores.messages,
      events,
    });

    const result = service.get(conversation.id);

    expect(result).toEqual({
      conversation,
      messages: [
        {
          id: "message-1",
          conversationId: conversation.id,
          actorId: "user-1",
          role: "USER",
          kind: "TEXT",
          content: "Build POLYON.",
          createdAt: "2026-09-27T01:01:00.000Z",
        },
      ],
      events: [
        {
          id: "event-1",
          kind: "MESSAGE_CREATED",
          actorId: "user-1",
          conversationId: conversation.id,
          missionId: "mission-1",
          occurredAt: "2026-09-27T01:01:00.000Z",
          data: {
            conversationId: conversation.id,
            messageId: "message-1",
          },
        },
      ],
    });
  });

  it("returns undefined for an unknown conversation", () => {
    const stores = new InMemoryDomainStores();

    const service = new ConversationQueryService({
      conversations: stores.conversations,
      messages: stores.messages,
      events: new InMemoryEventStore(),
    });

    expect(service.get("missing")).toBeUndefined();
  });

  it("fails when a conversation references a missing message", () => {
    const stores = new InMemoryDomainStores();
    stores.conversations.save(conversation);

    const service = new ConversationQueryService({
      conversations: stores.conversations,
      messages: stores.messages,
      events: new InMemoryEventStore(),
    });

    expect(() => service.get(conversation.id)).toThrowError(
      new ConversationQueryError(
        "MESSAGE_NOT_PERSISTED",
        "Conversation conversation-1 references missing message: message-1.",
      ),
    );
  });

  it("fails when a referenced message belongs to another conversation", () => {
    const stores = new InMemoryDomainStores();
    stores.conversations.save(conversation);
    stores.messages.save({
      id: "message-1",
      conversationId: "conversation-2",
      actorId: "user-1",
      role: "USER",
      kind: "TEXT",
      content: "Wrong conversation.",
      createdAt: "2026-09-27T01:01:00.000Z",
    });

    const service = new ConversationQueryService({
      conversations: stores.conversations,
      messages: stores.messages,
      events: new InMemoryEventStore(),
    });

    expect(() => service.get(conversation.id)).toThrowError(
      new ConversationQueryError(
        "MESSAGE_CONVERSATION_MISMATCH",
        "Message message-1 does not belong to conversation conversation-1.",
      ),
    );
  });
});
