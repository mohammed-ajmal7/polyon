import type {
  ActorId,
  Artifact,
  ArtifactId,
  ArtifactKind,
  ArtifactStatus,
  Conversation,
  DomainEvent,
  Execution,
  Message,
  MessageId,
} from "@polyon/contracts";
import type {
  ArtifactStore,
  ConversationStore,
  DomainStoreTransactionContext,
  DomainUnitOfWork,
  EventStore,
  ExecutionStore,
  MessageStore,
} from "@polyon/storage";

export interface PersistExecutionArtifactInput {
  readonly id: ArtifactId;
  readonly kind: ArtifactKind;
  readonly name: string;
  readonly mimeType?: string;
  readonly location: string;
  readonly status?: ArtifactStatus;
  readonly createdAt: string;
}

export interface PersistExecutionResultInput {
  readonly executionId: string;
  readonly conversationId: string;
  readonly messageId: MessageId;
  readonly actorId: ActorId;
  readonly output: string;
  readonly artifacts?: readonly PersistExecutionArtifactInput[];
  readonly createdAt: string;
}

export interface PersistedExecutionResult {
  readonly execution: Execution;
  readonly conversation: Conversation;
  readonly message: Message;
  readonly artifacts: readonly Artifact[];
  readonly events: readonly DomainEvent[];
}

export type ExecutionResultServiceErrorKind =
  | "EXECUTION_NOT_FOUND"
  | "EXECUTION_NOT_TERMINAL"
  | "CONVERSATION_NOT_FOUND"
  | "CONVERSATION_NOT_ACTIVE"
  | "CONVERSATION_MISSION_MISMATCH"
  | "CONVERSATION_KIND_MISMATCH"
  | "ACTOR_NOT_PARTICIPANT"
  | "MESSAGE_EXISTS"
  | "ARTIFACT_EXISTS"
  | "DUPLICATE_ARTIFACT_ID";

export interface ExecutionResultServiceDependencies {
  readonly executions: ExecutionStore;
  readonly conversations: ConversationStore;
  readonly messages: MessageStore;
  readonly artifacts: ArtifactStore;
  readonly events: EventStore;
  readonly unitOfWork?: DomainUnitOfWork;
}

export class ExecutionResultService {
  constructor(private readonly dependencies: ExecutionResultServiceDependencies) {}

  persist(input: PersistExecutionResultInput): PersistedExecutionResult {
    const operation = (
      stores: Pick<
        DomainStoreTransactionContext,
        "executions" | "conversations" | "messages" | "artifacts" | "events"
      >,
    ) => this.persistWithStores(stores, input);

    return this.dependencies.unitOfWork === undefined
      ? operation(this.dependencies)
      : this.dependencies.unitOfWork.transaction(operation);
  }

  private persistWithStores(
    stores: Pick<
      DomainStoreTransactionContext,
      "executions" | "conversations" | "messages" | "artifacts" | "events"
    >,
    input: PersistExecutionResultInput,
  ): PersistedExecutionResult {
    const execution = stores.executions.get(input.executionId);

    if (execution === undefined) {
      throw new ExecutionResultServiceError(
        "EXECUTION_NOT_FOUND",
        "Execution not found: " + input.executionId + ".",
      );
    }

    if (!isTerminalExecution(execution.status)) {
      throw new ExecutionResultServiceError(
        "EXECUTION_NOT_TERMINAL",
        "Cannot persist a result while execution " +
          execution.id +
          " is " +
          execution.status +
          ".",
      );
    }

    const conversation = stores.conversations.get(input.conversationId);

    if (conversation === undefined) {
      throw new ExecutionResultServiceError(
        "CONVERSATION_NOT_FOUND",
        "Conversation not found: " + input.conversationId + ".",
      );
    }

    if (conversation.status !== "ACTIVE") {
      throw new ExecutionResultServiceError(
        "CONVERSATION_NOT_ACTIVE",
        "Cannot publish an execution result to conversation " +
          conversation.id +
          " while status is " +
          conversation.status +
          ".",
      );
    }

    if (conversation.kind !== "MISSION") {
      throw new ExecutionResultServiceError(
        "CONVERSATION_KIND_MISMATCH",
        "Conversation " +
          conversation.id +
          " is " +
          conversation.kind +
          ", not MISSION.",
      );
    }

    if (conversation.missionId !== execution.missionId) {
      throw new ExecutionResultServiceError(
        "CONVERSATION_MISSION_MISMATCH",
        "Conversation " +
          conversation.id +
          " is not bound to execution mission " +
          execution.missionId +
          ".",
      );
    }

    if (!conversation.participantIds.includes(input.actorId)) {
      throw new ExecutionResultServiceError(
        "ACTOR_NOT_PARTICIPANT",
        "Result actor is not a participant in conversation " + conversation.id + ".",
      );
    }

    if (stores.messages.get(input.messageId) !== undefined) {
      throw new ExecutionResultServiceError(
        "MESSAGE_EXISTS",
        "Message already exists: " + input.messageId + ".",
      );
    }

    const artifactIds = new Set<string>();

    for (const artifact of input.artifacts ?? []) {
      if (artifactIds.has(artifact.id)) {
        throw new ExecutionResultServiceError(
          "DUPLICATE_ARTIFACT_ID",
          "Artifact ID is duplicated in the result: " + artifact.id + ".",
        );
      }

      artifactIds.add(artifact.id);

      if (stores.artifacts.get(artifact.id) !== undefined) {
        throw new ExecutionResultServiceError(
          "ARTIFACT_EXISTS",
          "Artifact already exists: " + artifact.id + ".",
        );
      }
    }

    const message = createResultMessage(input, execution);
    const artifacts = (input.artifacts ?? []).map((artifact) =>
      createArtifact(artifact, execution),
    );
    const updatedConversation: Conversation = {
      ...conversation,
      messageIds: [...conversation.messageIds, message.id],
      updatedAt: input.createdAt,
    };

    stores.messages.save(message);
    for (const artifact of artifacts) {
      stores.artifacts.save(artifact);
    }
    stores.conversations.save(updatedConversation);

    const events: DomainEvent[] = [];
    events.push(appendMessageCreatedEvent(stores.events, message, execution));
    for (const artifact of artifacts) {
      events.push(
        appendArtifactCreatedEvent(stores.events, artifact, conversation.id),
      );
    }

    return {
      execution,
      conversation: updatedConversation,
      message,
      artifacts,
      events,
    };
  
  }
}
