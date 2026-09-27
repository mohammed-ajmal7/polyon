import type { Conversation, ConversationId, DomainEvent, Message } from "@polyon/contracts";

import type { ConversationStore, EventStore, MessageStore } from "@polyon/storage";

export interface ConversationQueryDependencies {
  readonly conversations: ConversationStore;
  readonly messages: MessageStore;
  readonly events: EventStore;
}

export interface ConversationSnapshot {
  readonly conversation: Conversation;
  readonly messages: readonly Message[];
  readonly events: readonly DomainEvent[];
}

export type ConversationQueryErrorKind =
  | "CONVERSATION_NOT_FOUND"
  | "MESSAGE_NOT_PERSISTED"
  | "MESSAGE_CONVERSATION_MISMATCH";

export class ConversationQueryError extends Error {
  readonly kind: ConversationQueryErrorKind;

  constructor(kind: ConversationQueryErrorKind, message: string) {
    super(message);
    this.name = "ConversationQueryError";
    this.kind = kind;
  }
}

export class ConversationQueryService {
  constructor(private readonly dependencies: ConversationQueryDependencies) {}

  get(conversationId: ConversationId): ConversationSnapshot | undefined {
    const conversation = this.dependencies.conversations.get(conversationId);

    if (conversation === undefined) {
      return undefined;
    }

    const messages: Message[] = [];

    for (const messageId of conversation.messageIds) {
      const message = this.dependencies.messages.get(messageId);

      if (message === undefined) {
        throw new ConversationQueryError(
          "MESSAGE_NOT_PERSISTED",
          `Conversation ${conversation.id} references missing message: ${messageId}.`,
        );
      }

      if (message.conversationId !== conversation.id) {
        throw new ConversationQueryError(
          "MESSAGE_CONVERSATION_MISMATCH",
          `Message ${message.id} does not belong to conversation ${conversation.id}.`,
        );
      }

      messages.push(message);
    }

    return {
      conversation,
      messages,
      events: this.dependencies.events.listByConversation(conversation.id),
    };
  }
}
