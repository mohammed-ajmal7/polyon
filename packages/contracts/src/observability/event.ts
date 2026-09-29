import type { ActorId } from "../actor/ids";
import type { ConversationId } from "../communication/ids";
import type { AgentRunId, ExecutionId, MissionId, TaskId } from "../work/ids";
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
  | "MODEL_INVOCATION_RECORDED"
  | "AGENT_RUN_CREATED"
  | "AGENT_RUN_STATUS_CHANGED"
  | "EXECUTION_ROUTED"
  | "EXECUTION_RECOVERED"
  | "EXECUTION_STATUS_CHANGED"
  | "ARTIFACT_CREATED"
  | "INTEGRATION_INVOKED"
  | "TOOL_INVOKED"
  | "MESSAGE_CREATED"
  | "AGENT_MESSAGE_CREATED"
  | "JOB_CREATED"
  | "JOB_STATUS_CHANGED"
  | "JOB_RECOVERED"
  | "COLLECTIVE_STARTED"
  | "COLLECTIVE_CONTRIBUTION"
  | "COLLECTIVE_CHALLENGE"
  | "COLLECTIVE_SYNTHESIZED"
  | "RESEARCH_STARTED"
  | "RESEARCH_FINDING"
  | "RESEARCH_COMPLETED"
  | "DEEP_ANALYSIS_STARTED"
  | "DEEP_ANALYSIS_COMPLETED"
  | "MEMORY_RECORDED"
  | "SOURCE_RETRIEVED"
  | "EVIDENCE_CAPTURED"
  | "RESEARCH_SYNTHESIZED"
  | "MISSION_PLAN_GENERATED"
  | "DEBATE_STATUS_CHANGED"
  | "DEBATE_CONTRIBUTION"
  | "DEBATE_DECIDED"
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
  readonly agentRunId?: AgentRunId;

  readonly traceId?: string;
  readonly causedByEventId?: EventId;

  readonly occurredAt: string;
  readonly data: Readonly<Record<string, unknown>>;
}
