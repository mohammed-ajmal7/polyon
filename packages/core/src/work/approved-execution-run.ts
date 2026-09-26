import type { ApprovalRequest, Execution } from "@polyon/contracts";

import { transitionExecutionStatus } from "./execution-transition";

export type ApprovedExecutionRunErrorKind =
  | "APPROVAL_NOT_APPROVED"
  | "APPROVAL_EXPIRED"
  | "APPROVAL_ACTION_MISMATCH"
  | "APPROVAL_MISSION_MISMATCH"
  | "APPROVAL_TASK_MISMATCH"
  | "APPROVAL_EXECUTION_MISMATCH";

export class ApprovedExecutionRunError extends Error {
  readonly kind: ApprovedExecutionRunErrorKind;

  constructor(kind: ApprovedExecutionRunErrorKind, message: string) {
    super(message);
    this.name = "ApprovedExecutionRunError";
    this.kind = kind;
  }
}

export function applyApprovedExecutionRun(
  approval: ApprovalRequest,
  execution: Execution,
  evaluatedAt: string,
): Execution {
  if (approval.status !== "APPROVED") {
    throw new ApprovedExecutionRunError(
      "APPROVAL_NOT_APPROVED",
      `Cannot approve execution run with approval status: ${approval.status}.`,
    );
  }

  if (approval.expiresAt !== undefined && evaluatedAt >= approval.expiresAt) {
    throw new ApprovedExecutionRunError(
      "APPROVAL_EXPIRED",
      "Approval has expired and can no longer authorize execution.",
    );
  }

  if (approval.action !== "EXECUTION_RUN") {
    throw new ApprovedExecutionRunError(
      "APPROVAL_ACTION_MISMATCH",
      `Approval action does not authorize execution run: ${approval.action}.`,
    );
  }

  if (approval.missionId !== execution.missionId) {
    throw new ApprovedExecutionRunError(
      "APPROVAL_MISSION_MISMATCH",
      "Approval is not bound to the supplied execution mission.",
    );
  }

  if (approval.taskId !== execution.taskId) {
    throw new ApprovedExecutionRunError(
      "APPROVAL_TASK_MISMATCH",
      "Approval is not bound to the supplied execution task.",
    );
  }

  if (approval.executionId !== execution.id) {
    throw new ApprovedExecutionRunError(
      "APPROVAL_EXECUTION_MISMATCH",
      "Approval is not bound to the supplied execution.",
    );
  }

  return transitionExecutionStatus(execution, "APPROVED", evaluatedAt);
}
