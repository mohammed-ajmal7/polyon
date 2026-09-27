import type { ActorId } from "../actor/ids";
import type { ExecutionId, MissionId, MissionPlanProposalId, TaskId } from "../work/ids";
import type { ApprovalRequestId, PolicyDecisionId, PolicyId } from "./ids";
import type { ActionKind, RiskLevel } from "./risk";
import type {
  ModelMessage,
  ModelToolCall,
  TextModelRequest,
  TextModelResponse,
} from "../agent/model-invocation";

export type ApprovalStatus = "PENDING" | "APPROVED" | "REJECTED" | "EXPIRED" | "CANCELLED";

export interface ApprovalRequest {
  readonly id: ApprovalRequestId;

  readonly policyId: PolicyId;
  readonly policyDecisionId: PolicyDecisionId;

  readonly missionId?: MissionId;
  readonly proposalId?: MissionPlanProposalId;
  readonly taskId?: TaskId;
  readonly executionId?: ExecutionId;
  readonly toolId?: import("../tool/ids").ToolId;
  readonly invocationId?: string;

  readonly action: ActionKind;
  readonly riskLevel: RiskLevel;

  readonly requestedBy: ActorId;
  readonly reason: string;

  readonly status: ApprovalStatus;

  readonly requestedAt: string;
  readonly resolvedAt?: string;
  readonly expiresAt?: string;
  readonly resolvedBy?: ActorId;

  /**
   * Durable continuation checkpoint for a model-driven tool approval.
   * The checkpoint is advanced after each externally visible step so a
   * process restart can resume without re-running a completed tool call.
   */
  readonly toolContinuation?: {
    readonly agentId: string;
    readonly requiredCapabilityIds: readonly string[];
    readonly request: TextModelRequest;
    readonly response: TextModelResponse;
    readonly toolCall: ModelToolCall;
    readonly rounds: number;
    readonly state: "AWAITING_TOOL" | "AWAITING_MODEL" | "RESPONSE_READY" | "COMPLETED";
    readonly toolOutput?: unknown;
    readonly nextRequest?: TextModelRequest;
  };
}
