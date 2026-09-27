import type { ActorId, DomainEvent, EventId, Mission, MissionId } from "@polyon/contracts";
import { createMission } from "@polyon/core";
import type { EventStore, MissionStore } from "@polyon/storage";

export interface MissionCreationServiceDependencies {
  readonly missions: MissionStore;
  readonly events: EventStore;
}

export interface CreateMissionApplicationInput {
  readonly id: MissionId;
  readonly objective: string;
  readonly constraints?: readonly string[];
  readonly actorId: ActorId;
  readonly eventId: EventId;
  readonly conversationId?: string;
  readonly createdAt: string;
}

export interface CreateMissionApplicationResult {
  readonly mission: Mission;
  readonly event: DomainEvent;
}

export type MissionCreationServiceErrorKind = "MISSION_EXISTS" | "EVENT_EXISTS";

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

    const mission = createMission({
      id: input.id,
      objective: input.objective,
      constraints: input.constraints ?? [],
      createdAt: input.createdAt,
    });

    const event: DomainEvent = {
      id: input.eventId,
      kind: "MISSION_CREATED",
      actorId: input.actorId,
      ...(input.conversationId !== undefined ? { conversationId: input.conversationId } : {}),
      missionId: mission.id,
      occurredAt: input.createdAt,
      data: {
        missionId: mission.id,
        objective: mission.objective,
        status: mission.status,
        taskCount: mission.taskIds.length,
      },
    };

    this.dependencies.missions.save(mission);
    this.dependencies.events.append(event);

    return { mission, event };
  }
}
