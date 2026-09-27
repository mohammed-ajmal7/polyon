import type { ActorId } from "../actor/ids";
import type { IntegrationSideEffectClass } from "../integration/side-effect-class";
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
  readonly integrationId?: string;
  readonly invocationId?: string;
  readonly integrationInvocation?: {
    readonly operation: string;
    readonly input: unknown;
  };

  /**
   * Durable checkpoint for a model-driven external integration approval.
   * NON_IDEMPOTENT operations must not be automatically replayed after an
   * interrupted process because the side effect may already have occurred.
   */
  readonly integrationContinuation?: {
    readonly agentId: string;
    readonly requiredCapabilityIds: readonly string[];
    readonly request: TextModelRequest;
    readonly response: TextModelResponse;
    readonly toolCall: ModelToolCall;
    readonly rounds: number;
    readonly integrationId: string;
    readonly operation: string;
    readonly input: unknown;
    readonly sideEffectClass: IntegrationSideEffectClass;
    readonly state:
      | "AWAITING_INTEGRATION"
      | "AWAITING_MODEL"
      | "RESPONSE_READY"
      | "COMPLETED"
      | "RECONCILIATION_REQUIRED";
    readonly integrationOutput?: unknown;
    readonly nextRequest?: TextModelRequest;
  };

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
