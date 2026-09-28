import type {
  AgentId,
  AgentMessageType,
  ConversationId,
  DomainEvent,
  Message,
  MessageId,
} from "@polyon/contracts";
import type { ConversationStore, DomainUnitOfWork, EventStore, MessageStore } from "@polyon/storage";

const MAX_RUN_ID_LENGTH = 160;
const MAX_CONTENT_CHARACTERS = 12_000;
const MAX_PAYLOAD_CHARACTERS = 32_000;

export interface SendAgentMessageInput {
  readonly messageId: MessageId;
  readonly runId: string;
  readonly conversationId: ConversationId;
  readonly fromAgentId: AgentId;
  readonly toAgentId?: AgentId;
  readonly agentMessageType: AgentMessageType;
  readonly content: string;
  readonly payload: unknown;
  readonly participantAgentIds: readonly AgentId[];
  readonly createdAt: string;
}

export interface AgentMessageServiceDependencies {
  readonly conversations: ConversationStore;
  readonly messages: MessageStore;
  readonly events: EventStore;
  readonly unitOfWork?: DomainUnitOfWork;
}

export class AgentMessageService {
  constructor(private readonly dependencies: AgentMessageServiceDependencies) {}

  send(input: SendAgentMessageInput): Message {
    validateInput(input);

    const message: Message = {
      id: input.messageId,
      conversationId: input.conversationId,
      actorId: input.fromAgentId,
      role: "AGENT",
      kind: "TEXT",
      content: input.content.trim(),
      runId: input.runId.trim(),
      fromAgentId: input.fromAgentId,
      ...(input.toAgentId === undefined ? {} : { toAgentId: input.toAgentId }),
      agentMessageType: input.agentMessageType,
      payload: structuredClone(input.payload),
      createdAt: input.createdAt,
    };

    const operation = (
      stores: Pick<DomainStoreTransactionContext, "conversations" | "messages" | "events">,
    ): Message => {
      const existing = stores.messages.get(message.id);
      if (existing !== undefined) {
        return existing;
      }

      const conversation = stores.conversations.get(message.conversationId);
      if (conversation === undefined) {
        throw new Error(`Conversation not found: ${message.conversationId}.`);
      }

      stores.messages.save(message);
      stores.conversations.save({
        ...conversation,
        messageIds: [...conversation.messageIds, message.id],
        updatedAt: message.createdAt,
      });

      const event: DomainEvent = {
        id: `AGENT_MESSAGE_CREATED:${message.id}`,
        kind: "AGENT_MESSAGE_CREATED",
        actorId: message.actorId,
        conversationId: message.conversationId,
        occurredAt: message.createdAt,
        data: {
          messageId: message.id,
          runId: input.runId,
          fromAgentId: input.fromAgentId,
          ...(input.toAgentId === undefined ? {} : { toAgentId: input.toAgentId }),
          agentMessageType: input.agentMessageType,
          payloadSize: JSON.stringify(input.payload).length,
        },
      };
      stores.events.append(event);

      return message;
    };

    if (this.dependencies.unitOfWork === undefined) {
      return operation({
        conversations: this.dependencies.conversations,
        messages: this.dependencies.messages,
        events: this.dependencies.events,
      });
    }

    return this.dependencies.unitOfWork.transaction(operation);
  }

  listByRun(runId: string, conversationId?: ConversationId): readonly Message[] {
    const normalizedRunId = runId.trim();
    if (normalizedRunId.length === 0 || normalizedRunId.length > MAX_RUN_ID_LENGTH) {
      throw new RangeError(`runId must contain 1-${MAX_RUN_ID_LENGTH} characters.`);
    }

    return this.dependencies.messages
      .list()
      .filter(
        (message) =>
          message.runId === normalizedRunId &&
          message.agentMessageType !== undefined &&
          (conversationId === undefined || message.conversationId === conversationId),
      );
  }
}

function validateInput(input: SendAgentMessageInput): void {
  const runId = input.runId.trim();
  if (runId.length === 0 || runId.length > MAX_RUN_ID_LENGTH) {
    throw new RangeError(`runId must contain 1-${MAX_RUN_ID_LENGTH} characters.`);
  }

  const content = input.content.trim();
  if (content.length === 0 || content.length > MAX_CONTENT_CHARACTERS) {
    throw new RangeError(
      `Agent message content must contain 1-${MAX_CONTENT_CHARACTERS} characters.`,
    );
  }

  if (!input.participantAgentIds.includes(input.fromAgentId)) {
    throw new Error(`Source agent is not a participant: ${input.fromAgentId}.`);
  }

  if (
    input.toAgentId !== undefined &&
    !input.participantAgentIds.includes(input.toAgentId)
  ) {
    throw new Error(`Target agent is not a participant: ${input.toAgentId}.`);
  }

  let payloadCharacters: number;
  try {
    payloadCharacters = JSON.stringify(input.payload).length;
  } catch (error) {
    throw new RangeError("Agent message payload must be JSON-serializable.", { cause: error });
  }

  if (payloadCharacters > MAX_PAYLOAD_CHARACTERS) {
    throw new RangeError(
      `Agent message payload exceeds ${MAX_PAYLOAD_CHARACTERS} serialized characters.`,
    );
  }
}
