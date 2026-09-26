import type {
  ActorId,
  ApprovalRequest,
  ApprovalRequestId,
  ExecutionId,
  MissionId,
  PolicyDecision,
  TaskId,
} from "@polyon/contracts";

export interface CreateApprovalRequestInput {
  readonly id: ApprovalRequestId;
  readonly requestedBy: ActorId;
  readonly requestedAt: string;
  readonly missionId?: MissionId;
  readonly taskId?: TaskId;
  readonly executionId?: ExecutionId;
  readonly expiresAt?: string;
}

export class ApprovalNotRequiredError extends Error {
  constructor(effect: PolicyDecision["effect"]) {
    super(`Cannot create approval request for policy effect: ${effect}`);
    this.name = "ApprovalNotRequiredError";
  }
}

export function createApprovalRequest(
  decision: PolicyDecision,
  input: CreateApprovalRequestInput,
): ApprovalRequest {
  if (decision.effect !== "REQUIRE_APPROVAL") {
    throw new ApprovalNotRequiredError(decision.effect);
  }

  return {
    id: input.id,
    policyId: decision.policyId,
    policyDecisionId: decision.id,
    missionId: input.missionId,
    taskId: input.taskId,
    executionId: input.executionId,
    action: decision.action,
    riskLevel: decision.riskLevel,
    requestedBy: input.requestedBy,
    reason: decision.reason,
    status: "PENDING",
    requestedAt: input.requestedAt,
    expiresAt: input.expiresAt,
  };
}
