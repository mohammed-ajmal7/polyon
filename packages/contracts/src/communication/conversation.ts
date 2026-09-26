import type { ActorId } from "../actor/ids";
import type { MissionId } from "../work/ids";
import type { ConversationId, MessageId } from "./ids";

export type ConversationKind = "DIRECT" | "BROADCAST" | "DEBATE" | "MISSION" | "OTHER";

export type ConversationStatus = "ACTIVE" | "PAUSED" | "COMPLETED" | "CANCELLED";

export interface Conversation {
  readonly id: ConversationId;

  readonly kind: ConversationKind;
  readonly status: ConversationStatus;

  readonly participantIds: readonly ActorId[];
  readonly messageIds: readonly MessageId[];

  readonly missionId?: MissionId;

  readonly createdAt: string;
  readonly updatedAt: string;
}
