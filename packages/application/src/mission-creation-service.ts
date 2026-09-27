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
import type { ConversationStore, EventStore, MissionStore } from "@polyon/storage";

export interface MissionCreationServiceDependencies {
  readonly conversations: ConversationStore;
  readonly missions: MissionStore;
  readonly events: EventStore;
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
    if (this.dependencies.missions.get(input.id) !== undefined) {
      throw new MissionCreationServiceError(
        "MISSION_EXISTS",
        `Mission already exists: ${input.id}.`,
      );
    }

    if (this.dependencies.events.get(input.eventId) !== undefined) {
      throw new MissionCreationServiceError(
        "EVENT_EXISTS",
        `Event already exists: ${input.eventId}.`,
      );
    }

    const conversation = this.dependencies.conversations.get(input.conversationId);

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

    this.dependencies.missions.save(mission);
    this.dependencies.conversations.save(updatedConversation);
    this.dependencies.events.append(event);

    return {
      mission,
      conversation: updatedConversation,
      event,
    };
  }
}
