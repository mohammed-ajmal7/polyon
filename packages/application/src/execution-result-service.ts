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
  readonly taskOrchestration?: Pick<
    import("./mission-task-orchestration-service").MissionTaskOrchestrationService,
    "advanceReadyTasks"
  >;
  readonly executions: ExecutionStore;
  readonly conversations: ConversationStore;
  readonly messages: MessageStore;
  readonly artifacts: ArtifactStore;
  readonly events: EventStore;
  readonly unitOfWork?: DomainUnitOfWork;
}

type ExecutionResultStores = Pick<
  DomainStoreTransactionContext,
  "executions" | "conversations" | "messages" | "artifacts" | "events"
>;

export class ExecutionResultServiceError extends Error {
  readonly kind: ExecutionResultServiceErrorKind;

  constructor(kind: ExecutionResultServiceErrorKind, message: string) {
    super(message);
    this.name = "ExecutionResultServiceError";
    this.kind = kind;
  }
}

function isTerminalExecution(status: Execution["status"]): boolean {
  return (
    status === "SUCCEEDED" ||
    status === "FAILED" ||
    status === "CANCELLED" ||
    status === "REJECTED"
  );
}

function createResultMessage(
  input: PersistExecutionResultInput,
  execution: Execution,
): Message {
  return {
    id: input.messageId,
    conversationId: input.conversationId,
    actorId: input.actorId,
    role: execution.status === "FAILED" ? "SYSTEM" : "AGENT",
    kind: execution.status === "FAILED" ? "ERROR" : "TEXT",
    content: input.output,
    createdAt: input.createdAt,
  };
}

function createArtifact(
  input: PersistExecutionArtifactInput,
  execution: Execution,
): Artifact {
  return {
    id: input.id,
    kind: input.kind,
    name: input.name,
    ...(input.mimeType !== undefined ? { mimeType: input.mimeType } : {}),
    location: input.location,
    status: input.status ?? "AVAILABLE",
    missionId: execution.missionId,
    taskId: execution.taskId,
    executionId: execution.id,
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
  };
}

function appendMessageCreatedEvent(
  events: EventStore,
  message: Message,
  execution: Execution,
): DomainEvent {
  const event: DomainEvent = {
    id: "MESSAGE_CREATED:" + message.id,
    kind: "MESSAGE_CREATED",
    actorId: message.actorId,
    conversationId: message.conversationId,
    missionId: execution.missionId,
    taskId: execution.taskId,
    executionId: execution.id,
    occurredAt: message.createdAt,
    data: {
      messageId: message.id,
      conversationId: message.conversationId,
      executionId: execution.id,
      kind: message.kind,
    },
  };

  events.append(event);
  return event;
}

function areArtifactsEqual(
  actual: Artifact,
  expected: Artifact,
): boolean {
  return (
    actual.id === expected.id &&
    actual.kind === expected.kind &&
    actual.name === expected.name &&
    actual.mimeType === expected.mimeType &&
    actual.location === expected.location &&
    actual.status === expected.status &&
    actual.missionId === expected.missionId &&
    actual.taskId === expected.taskId &&
    actual.executionId === expected.executionId &&
    actual.createdAt === expected.createdAt &&
    actual.updatedAt === expected.updatedAt
  );
}

function getIdempotentResult(
  stores: ExecutionResultStores,
  input: PersistExecutionResultInput,
  execution: Execution,
  conversation: Conversation,
): PersistedExecutionResult | undefined {
  const existingMessage = stores.messages.get(input.messageId);

  if (existingMessage === undefined) {
    return undefined;
  }

  const expectedMessage = createResultMessage(input, execution);

  if (JSON.stringify(existingMessage) !== JSON.stringify(expectedMessage)) {
    return undefined;
  }

  if (!conversation.messageIds.includes(existingMessage.id)) {
    return undefined;
  }

  const expectedArtifacts = (input.artifacts ?? []).map((artifact) =>
    createArtifact(artifact, execution),
  );
  const persistedArtifacts = stores.artifacts
    .list()
    .filter((artifact) => artifact.executionId === execution.id)
    .filter((artifact) => expectedArtifacts.some((expected) => expected.id === artifact.id));

  if (
    persistedArtifacts.length !== expectedArtifacts.length ||
    persistedArtifacts.some(
      (artifact) =>
        !areArtifactsEqual(
          artifact,
          expectedArtifacts.find((expected) => expected.id === artifact.id)!,
        ),
    )
  ) {
    return undefined;
  }

  const eventIds = new Set([
    "MESSAGE_CREATED:" + existingMessage.id,
    ...expectedArtifacts.map((artifact) => "ARTIFACT_CREATED:" + artifact.id),
  ]);
  const events = stores.events
    .listByExecution(execution.id)
    .filter((event) => eventIds.has(event.id));

  if (events.length !== 1 + expectedArtifacts.length) {
    return undefined;
  }

  return {
    execution,
    conversation,
    message: existingMessage,
    artifacts: persistedArtifacts,
    events,
  };
}

function appendArtifactCreatedEvent(
  events: EventStore,
  artifact: Artifact,
  conversationId: string,
): DomainEvent {
  const event: DomainEvent = {
    id: "ARTIFACT_CREATED:" + artifact.id,
    kind: "ARTIFACT_CREATED",
    conversationId,
    missionId: artifact.missionId,
    taskId: artifact.taskId,
    executionId: artifact.executionId,
    occurredAt: artifact.createdAt,
    data: {
      artifactId: artifact.id,
      name: artifact.name,
      kind: artifact.kind,
      location: artifact.location,
      status: artifact.status,
    },
  };

  events.append(event);
  return event;
}

export class ExecutionResultService {
  constructor(private readonly dependencies: ExecutionResultServiceDependencies) {}

  persist(input: PersistExecutionResultInput): PersistedExecutionResult {
    const operation = (stores: ExecutionResultStores) =>
      this.persistWithStores(stores, input);

    const result =
      this.dependencies.unitOfWork === undefined
        ? operation(this.dependencies)
        : this.dependencies.unitOfWork.transaction(operation);

    if (
      result.execution.status === "SUCCEEDED" &&
      this.dependencies.taskOrchestration !== undefined
    ) {
      this.dependencies.taskOrchestration.advanceReadyTasks({
        missionId: result.execution.missionId,
        actorId: result.execution.actorId,
        now: result.execution.completedAt ?? input.createdAt,
      });
    }

    return result;
  }

  private persistWithStores(
    stores: ExecutionResultStores,
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

    const idempotentResult = getIdempotentResult(
      stores,
      input,
      execution,
      conversation,
    );

    if (idempotentResult !== undefined) {
      return idempotentResult;
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
