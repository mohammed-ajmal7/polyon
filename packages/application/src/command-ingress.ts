import type {
  ActorId,
  Conversation,
  ConversationId,
  DomainEvent,
  EventId,
  Message,
  MessageId,
  MissionId,
} from "@polyon/contracts";

import type {
  ConversationStore,
  DomainStoreTransactionContext,
  DomainUnitOfWork,
  EventStore,
  MessageStore,
} from "@polyon/storage";

export type CommandMode =
  | "Direct"
  | "Broadcast"
  | "Collaborative"
  | "Debate"
  | "DeepAnalysis"
  | "Mission";

const modeToConversationKind: Record<CommandMode, Conversation["kind"]> = {
  Direct: "DIRECT",
  Broadcast: "BROADCAST",
  Collaborative: "COLLABORATIVE",
  Debate: "DEBATE",
  DeepAnalysis: "DEEP_ANALYSIS",
  Mission: "MISSION",
};

export interface CommandIngressInput {
  readonly mode: CommandMode;
  readonly command: string;
  readonly actorId: ActorId;

  readonly conversationId: ConversationId;
  readonly messageId: MessageId;
  readonly eventId: EventId;

  readonly participantIds?: readonly ActorId[];
  readonly missionId?: MissionId;
  readonly createdAt: string;
}

export interface CommandIngressDependencies {
  readonly conversations: ConversationStore;
  readonly messages: MessageStore;
  readonly events: EventStore;
  readonly unitOfWork?: DomainUnitOfWork;
}

type CommandIngressStores = Pick<
  DomainStoreTransactionContext,
  "conversations" | "messages" | "events"
>;

export interface CommandIngressResult {
  readonly conversation: Conversation;
  readonly message: Message;
  readonly event: DomainEvent;
}

export type CommandIngressErrorKind =
  | "COMMAND_REQUIRED"
  | "CONVERSATION_NOT_ACTIVE"
  | "CONVERSATION_KIND_MISMATCH"
  | "CONVERSATION_PARTICIPANTS_REQUIRED"
  | "ACTOR_NOT_PARTICIPANT"
  | "MISSION_MISMATCH"
  | "DUPLICATE_MESSAGE"
  | "DUPLICATE_EVENT";

export class CommandIngressError extends Error {
  readonly kind: CommandIngressErrorKind;

  constructor(kind: CommandIngressErrorKind, message: string) {
    super(message);
    this.name = "CommandIngressError";
    this.kind = kind;
  }
}

export class CommandIngressService {
  constructor(private readonly dependencies: CommandIngressDependencies) {}

  submit(input: CommandIngressInput): CommandIngressResult {
    const operation = (stores: CommandIngressStores) => this.submitWithStores(stores, input);

    return this.dependencies.unitOfWork === undefined
      ? operation(this.dependencies)
      : this.dependencies.unitOfWork.transaction(operation);
  }

  private submitWithStores(
    stores: CommandIngressStores,
    input: CommandIngressInput,
  ): CommandIngressResult {
    const command = input.command.trim();

    if (command === "") {
      throw new CommandIngressError("COMMAND_REQUIRED", "A command is required.");
    }

    const expectedKind = modeToConversationKind[input.mode];
    const existing = stores.conversations.get(input.conversationId);

    if (existing === undefined) {
      if (input.participantIds === undefined || input.participantIds.length === 0) {
        throw new CommandIngressError(
          "CONVERSATION_PARTICIPANTS_REQUIRED",
          "Participant IDs are required when creating a conversation.",
        );
      }

      const participants = [...new Set(input.participantIds)];

      if (!participants.includes(input.actorId)) {
        throw new CommandIngressError(
          "ACTOR_NOT_PARTICIPANT",
          "The submitting actor must be a conversation participant.",
        );
      }

      const conversation: Conversation = {
        id: input.conversationId,
        kind: expectedKind,
        status: "ACTIVE",
        participantIds: participants,
        messageIds: [],
        ...(input.missionId !== undefined ? { missionId: input.missionId } : {}),
        createdAt: input.createdAt,
        updatedAt: input.createdAt,
      };

      return this.persistSubmissionWithStores(stores, conversation, command, input);
    }

    if (existing.status !== "ACTIVE") {
      throw new CommandIngressError(
        "CONVERSATION_NOT_ACTIVE",
        `Cannot submit a command to conversation ${existing.id} while status is ${existing.status}.`,
      );
    }

    if (existing.kind !== expectedKind) {
      throw new CommandIngressError(
        "CONVERSATION_KIND_MISMATCH",
        `Conversation ${existing.id} is ${existing.kind}, not ${expectedKind}.`,
      );
    }

    if (!existing.participantIds.includes(input.actorId)) {
      throw new CommandIngressError(
        "ACTOR_NOT_PARTICIPANT",
        "The submitting actor is not a participant in this conversation.",
      );
    }

    if (input.missionId !== undefined && existing.missionId !== input.missionId) {
      throw new CommandIngressError(
        "MISSION_MISMATCH",
        `Conversation ${existing.id} is not bound to mission ${input.missionId}.`,
      );
    }

    return this.persistSubmissionWithStores(stores, existing, command, input);
  }

  private persistSubmissionWithStores(
    stores: CommandIngressStores,
    conversation: Conversation,
    command: string,
    input: CommandIngressInput,
  ): CommandIngressResult {
    if (stores.messages.get(input.messageId) !== undefined) {
      throw new CommandIngressError(
        "DUPLICATE_MESSAGE",
        `Message already exists: ${input.messageId}.`,
      );
    }

    if (stores.events.get(input.eventId) !== undefined) {
      throw new CommandIngressError("DUPLICATE_EVENT", `Event already exists: ${input.eventId}.`);
    }

    const message: Message = {
      id: input.messageId,
      conversationId: conversation.id,
      actorId: input.actorId,
      role: "USER",
      kind: "TEXT",
      content: command,
      createdAt: input.createdAt,
    };

    const updatedConversation: Conversation = {
      ...conversation,
      messageIds: [...conversation.messageIds, message.id],
      updatedAt: input.createdAt,
    };

    const event: DomainEvent = {
      id: input.eventId,
      kind: "MESSAGE_CREATED",
      actorId: input.actorId,
      conversationId: updatedConversation.id,
      ...(updatedConversation.missionId !== undefined
        ? { missionId: updatedConversation.missionId }
        : {}),
      occurredAt: input.createdAt,
      data: {
        conversationId: updatedConversation.id,
        messageId: message.id,
        mode: updatedConversation.kind,
      },
    };

    stores.messages.save(message);
    stores.conversations.save(updatedConversation);
    stores.events.append(event);

    return {
      conversation: updatedConversation,
      message,
      event,
    };
  }
}
