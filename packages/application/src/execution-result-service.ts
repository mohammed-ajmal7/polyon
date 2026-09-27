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
    const operation = (stores: ExecutionResultStores) =>
      this.persistWithStores(stores, input);

    return this.dependencies.unitOfWork === undefined
      ? operation(this.dependencies)
      : this.dependencies.unitOfWork.transaction(operation);
  }

  private persistWithStores(
    stores: ExecutionResultStores,
    input: PersistExecutionResultInput,
  ): PersistedExecutionResult {
    const operation = (
      stores: Pick<
        DomainStoreTransactionContext,
        "executions" | "conversations" | "messages" | "artifacts" | "events"
      >,
    ) => this.persistWithStores(stores, input);

    return stores.unitOfWork === undefined
      ? operation(this.dependencies)
      : stores.unitOfWork.transaction(operation);
  
  }
}
