import type { ApprovalRequest, Execution } from "@polyon/contracts";

import type { ExecutionRunAuthorization } from "./execution-authorization";
import { transitionExecutionStatus } from "./execution-transition";

export type ExecutionRunAuthorizationApplicationErrorKind =
  | "MISSING_APPROVAL_REQUEST"
  | "AUTHORIZATION_EFFECT_MISMATCH"
  | "AUTHORIZATION_ACTION_MISMATCH"
  | "APPROVAL_STATUS_MISMATCH"
  | "APPROVAL_ACTION_MISMATCH"
  | "APPROVAL_MISSION_MISMATCH"
  | "APPROVAL_TASK_MISMATCH"
  | "APPROVAL_EXECUTION_MISMATCH"
  | "APPROVAL_DECISION_MISMATCH";

export class ExecutionRunAuthorizationApplicationError extends Error {
  readonly kind: ExecutionRunAuthorizationApplicationErrorKind;

  constructor(kind: ExecutionRunAuthorizationApplicationErrorKind, message: string) {
    super(message);
    this.name = "ExecutionRunAuthorizationApplicationError";
    this.kind = kind;
  }
}

function validateApprovalBinding(
  authorization: ExecutionRunAuthorization,
  execution: Execution,
  approval: ApprovalRequest,
): void {
  if (authorization.policyDecision.action !== "EXECUTION_RUN") {
    throw new ExecutionRunAuthorizationApplicationError(
      "AUTHORIZATION_ACTION_MISMATCH",
      "Execution authorization does not authorize an execution run.",
    );
  }

  if (approval.status !== "PENDING") {
    throw new ExecutionRunAuthorizationApplicationError(
      "APPROVAL_STATUS_MISMATCH",
      `Approval must be pending when applying execution authorization: ${approval.status}.`,
    );
  }

  if (approval.action !== "EXECUTION_RUN") {
    throw new ExecutionRunAuthorizationApplicationError(
      "APPROVAL_ACTION_MISMATCH",
      `Approval action does not authorize execution run: ${approval.action}.`,
    );
  }

  if (approval.policyDecisionId !== authorization.policyDecision.id) {
    throw new ExecutionRunAuthorizationApplicationError(
      "APPROVAL_DECISION_MISMATCH",
      "Approval is not bound to the authorization policy decision.",
    );
  }

  if (approval.missionId !== execution.missionId) {
    throw new ExecutionRunAuthorizationApplicationError(
      "APPROVAL_MISSION_MISMATCH",
      "Approval is not bound to the supplied execution mission.",
    );
  }

  if (approval.taskId !== execution.taskId) {
    throw new ExecutionRunAuthorizationApplicationError(
      "APPROVAL_TASK_MISMATCH",
      "Approval is not bound to the supplied execution task.",
    );
  }

  if (approval.executionId !== execution.id) {
    throw new ExecutionRunAuthorizationApplicationError(
      "APPROVAL_EXECUTION_MISMATCH",
      "Approval is not bound to the supplied execution.",
    );
  }
}

export function applyExecutionRunAuthorization(
  authorization: ExecutionRunAuthorization,
  execution: Execution,
  now: string,
): Execution {
  if (authorization.status === "AUTHORIZED") {
    if (authorization.policyDecision.action !== "EXECUTION_RUN") {
      throw new ExecutionRunAuthorizationApplicationError(
        "AUTHORIZATION_ACTION_MISMATCH",
        "Execution authorization does not authorize an execution run.",
      );
    }

    if (authorization.policyDecision.effect !== "ALLOW") {
      throw new ExecutionRunAuthorizationApplicationError(
        "AUTHORIZATION_EFFECT_MISMATCH",
        "Authorized execution runs must have an ALLOW policy decision.",
      );
    }

    return transitionExecutionStatus(execution, "QUEUED", now);
  }

  if (authorization.policyDecision.effect !== "REQUIRE_APPROVAL") {
    throw new ExecutionRunAuthorizationApplicationError(
      "AUTHORIZATION_EFFECT_MISMATCH",
      "Approval-required execution authorization must have a REQUIRE_APPROVAL policy decision.",
    );
  }

  const approval = authorization.approvalRequest;

  if (approval === undefined) {
    throw new ExecutionRunAuthorizationApplicationError(
      "MISSING_APPROVAL_REQUEST",
      "Execution authorization requires an approval request.",
    );
  }

  validateApprovalBinding(authorization, execution, approval);

  return transitionExecutionStatus(execution, "APPROVAL_REQUIRED", now);
}
