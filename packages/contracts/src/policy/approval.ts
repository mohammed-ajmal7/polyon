import type { ActorId } from "../actor/ids";
import type { ExecutionId, MissionId, MissionPlanProposalId, TaskId } from "../work/ids";
import type { ApprovalRequestId, PolicyDecisionId, PolicyId } from "./ids";
import type { ActionKind, RiskLevel } from "./risk";

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

  readonly action: ActionKind;
  readonly riskLevel: RiskLevel;

  readonly requestedBy: ActorId;
  readonly reason: string;

  readonly status: ApprovalStatus;

  readonly requestedAt: string;
  readonly resolvedAt?: string;
  readonly expiresAt?: string;
  readonly resolvedBy?: ActorId;
}
