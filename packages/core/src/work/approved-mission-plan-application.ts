import type { ApprovalRequest, Mission, MissionPlanProposal, Task } from "@polyon/contracts";

import {
  applyMissionPlanProposal,
  InvalidMissionPlanProposalError,
} from "./mission-plan-application";

export type ApprovedMissionPlanApplicationErrorKind =
  | "APPROVAL_NOT_APPROVED"
  | "APPROVAL_EXPIRED"
  | "APPROVAL_ACTION_MISMATCH"
  | "APPROVAL_MISSION_MISMATCH"
  | "APPROVAL_PROPOSAL_MISMATCH"
  | "INVALID_PROPOSAL";

export class ApprovedMissionPlanApplicationError extends Error {
  readonly kind: ApprovedMissionPlanApplicationErrorKind;

  constructor(kind: ApprovedMissionPlanApplicationErrorKind, message: string) {
    super(message);
    this.name = "ApprovedMissionPlanApplicationError";
    this.kind = kind;
  }
}

export function applyApprovedMissionPlanProposal(
  approval: ApprovalRequest,
  proposal: MissionPlanProposal,
  mission: Mission,
  tasks: readonly Task[],
  evaluatedAt: string,
): Mission {
  if (approval.status !== "APPROVED") {
    throw new ApprovedMissionPlanApplicationError(
      "APPROVAL_NOT_APPROVED",
      `Cannot apply mission plan with approval status: ${approval.status}.`,
    );
  }

  if (approval.expiresAt !== undefined && evaluatedAt >= approval.expiresAt) {
    throw new ApprovedMissionPlanApplicationError(
      "APPROVAL_EXPIRED",
      "Approval has expired and can no longer authorize mission plan application.",
    );
  }

  if (approval.action !== "PLAN_APPLY") {
    throw new ApprovedMissionPlanApplicationError(
      "APPROVAL_ACTION_MISMATCH",
      `Approval action does not authorize mission plan application: ${approval.action}.`,
    );
  }

  if (approval.missionId !== mission.id) {
    throw new ApprovedMissionPlanApplicationError(
      "APPROVAL_MISSION_MISMATCH",
      "Approval is not bound to the supplied mission.",
    );
  }

  if (approval.proposalId !== proposal.id) {
    throw new ApprovedMissionPlanApplicationError(
      "APPROVAL_PROPOSAL_MISMATCH",
      "Approval is not bound to the supplied mission plan proposal.",
    );
  }

  try {
    return applyMissionPlanProposal(proposal, mission, tasks, evaluatedAt);
  } catch (error) {
    if (error instanceof InvalidMissionPlanProposalError) {
      throw new ApprovedMissionPlanApplicationError("INVALID_PROPOSAL", error.message);
    }

    throw error;
  }
}
