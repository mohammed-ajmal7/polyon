import type { ActorId } from "../actor/ids";
import type { ConversationId } from "../communication/ids";
import type { ExecutionId, MissionId, TaskId } from "../work/ids";
import type { EventId } from "./ids";

export type EventKind =
  | "MISSION_CREATED"
  | "MISSION_STATUS_CHANGED"
  | "MISSION_PLAN_PROPOSED"
  | "MISSION_PLAN_APPLIED"
  | "TASK_STATUS_CHANGED"
  | "POLICY_DECIDED"
  | "APPROVAL_REQUESTED"
  | "APPROVAL_RESOLVED"
  | "EXECUTION_CREATED"
  | "EXECUTION_ROUTED"
  | "EXECUTION_RECOVERED"
  | "EXECUTION_STATUS_CHANGED"
  | "ARTIFACT_CREATED"
  | "INTEGRATION_INVOKED"
  | "TOOL_INVOKED"
  | "MESSAGE_CREATED"
  | "MEMORY_RECORDED"
  | "SOURCE_RETRIEVED"
  | "EVIDENCE_CAPTURED"
  | "ERROR"
  | "OTHER";

export interface DomainEvent {
  readonly id: EventId;
  readonly kind: EventKind;

  readonly actorId?: ActorId;
  readonly conversationId?: ConversationId;
  readonly missionId?: MissionId;
  readonly taskId?: TaskId;
  readonly executionId?: ExecutionId;

  readonly traceId?: string;
  readonly causedByEventId?: EventId;

  readonly occurredAt: string;
  readonly data: Readonly<Record<string, unknown>>;
}
