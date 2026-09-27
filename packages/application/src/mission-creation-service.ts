import type {
  ActorId,
  Conversation,
  ConversationId,
  DomainEvent,
  EventId,
  Mission,
  MissionId,
} from "@polyon/contracts";
import { createMission } from "@polyon/core";
import type {
  ConversationStore,
  DomainStoreTransactionContext,
  DomainUnitOfWork,
  EventStore,
  MissionStore,
} from "@polyon/storage";

type MissionCreationStores = Pick<
  DomainStoreTransactionContext,
  "conversations" | "missions" | "events"
>;

export interface MissionCreationServiceDependencies extends MissionCreationStores {
  readonly unitOfWork?: DomainUnitOfWork;
}

export interface CreateMissionApplicationInput {
  readonly id: MissionId;
  readonly objective: string;
  readonly constraints?: readonly string[];
  readonly actorId: ActorId;
  readonly eventId: EventId;
  readonly conversationId: ConversationId;
  readonly createdAt: string;
}

export interface CreateMissionApplicationResult {
  readonly mission: Mission;
  readonly conversation: Conversation;
  readonly event: DomainEvent;
}

export type MissionCreationServiceErrorKind =
  | "CONVERSATION_NOT_FOUND"
  | "CONVERSATION_NOT_ACTIVE"
  | "CONVERSATION_KIND_MISMATCH"
  | "CONVERSATION_ALREADY_BOUND"
  | "MISSION_EXISTS"
  | "EVENT_EXISTS";

export class MissionCreationServiceError extends Error {
  readonly kind: MissionCreationServiceErrorKind;

  constructor(kind: MissionCreationServiceErrorKind, message: string) {
    super(message);
    this.name = "MissionCreationServiceError";
    this.kind = kind;
  }
}

export class MissionCreationService {
  constructor(private readonly dependencies: MissionCreationServiceDependencies) {}

  create(input: CreateMissionApplicationInput): CreateMissionApplicationResult {
    const operation = (stores: MissionCreationStores) => this.createWithStores(stores, input);

    return this.dependencies.unitOfWork === undefined
      ? operation(this.dependencies)
      : this.dependencies.unitOfWork.transaction(operation);
  }

  private createWithStores(
    stores: MissionCreationStores,
    input: CreateMissionApplicationInput,
  ): CreateMissionApplicationResult {
    if (stores.missions.get(input.id) !== undefined) {
      throw new MissionCreationServiceError(
        "MISSION_EXISTS",
        `Mission already exists: ${input.id}.`,
      );
    }

    if (stores.events.get(input.eventId) !== undefined) {
      throw new MissionCreationServiceError(
        "EVENT_EXISTS",
        `Event already exists: ${input.eventId}.`,
      );
    }

    const conversation = stores.conversations.get(input.conversationId);

    if (conversation === undefined) {
      throw new MissionCreationServiceError(
        "CONVERSATION_NOT_FOUND",
        `Conversation not found: ${input.conversationId}.`,
      );
    }

    if (conversation.status !== "ACTIVE") {
      throw new MissionCreationServiceError(
        "CONVERSATION_NOT_ACTIVE",
        `Cannot create a mission from conversation ${conversation.id} while status is ${conversation.status}.`,
      );
    }

    if (conversation.kind !== "MISSION") {
      throw new MissionCreationServiceError(
        "CONVERSATION_KIND_MISMATCH",
        `Conversation ${conversation.id} is ${conversation.kind}, not MISSION.`,
      );
    }

    if (conversation.missionId !== undefined) {
      throw new MissionCreationServiceError(
        "CONVERSATION_ALREADY_BOUND",
        `Conversation ${conversation.id} is already bound to mission ${conversation.missionId}.`,
      );
    }

    const mission = createMission({
      id: input.id,
      objective: input.objective,
      constraints: input.constraints ?? [],
      createdAt: input.createdAt,
    });

    const updatedConversation: Conversation = {
      ...conversation,
      missionId: mission.id,
      updatedAt: input.createdAt,
    };

    const event: DomainEvent = {
      id: input.eventId,
      kind: "MISSION_CREATED",
      actorId: input.actorId,
      conversationId: updatedConversation.id,
      missionId: mission.id,
      occurredAt: input.createdAt,
      data: {
        conversationId: updatedConversation.id,
        missionId: mission.id,
        objective: mission.objective,
        status: mission.status,
        taskCount: mission.taskIds.length,
      },
    };

    stores.missions.save(mission);
    stores.conversations.save(updatedConversation);
    stores.events.append(event);

    return {
      mission,
      conversation: updatedConversation,
      event,
    };
  }
}
