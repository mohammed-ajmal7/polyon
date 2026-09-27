import type {
  ActorId,
  ApprovalRequest,
  ApprovalRequestId,
  Execution,
  Policy,
  PolicyDecision,
  PolicyDecisionId,
  RiskLevel,
} from "@polyon/contracts";

import { createApprovalRequest, evaluatePolicy } from "../policy/index";

export interface AuthorizeExecutionRunInput {
  readonly execution: Execution;
  readonly policy: Policy;
  readonly decisionId: PolicyDecisionId;
  readonly approvalRequestId: ApprovalRequestId;
  readonly requestedBy: ActorId;
  readonly requestedAt: string;
  readonly evaluatedAt: string;
  readonly riskLevel: RiskLevel;
  readonly expiresAt?: string;
}

export interface ExecutionRunAuthorization {
  readonly status: "AUTHORIZED" | "APPROVAL_REQUIRED";
  readonly policyDecision: PolicyDecision;
  readonly approvalRequest?: ApprovalRequest;
}

export type ExecutionRunAuthorizationErrorKind =
  | "EXECUTION_NOT_PENDING"
  | "EXECUTION_RUN_DENIED";

export class ExecutionRunAuthorizationError extends Error {
  readonly kind: ExecutionRunAuthorizationErrorKind;
  readonly decision?: PolicyDecision;

  constructor(
    kind: ExecutionRunAuthorizationErrorKind,
    message: string,
    decision?: PolicyDecision,
  ) {
    super(message);
    this.name = "ExecutionRunAuthorizationError";
    this.kind = kind;
    this.decision = decision;
  }
}

export function authorizeExecutionRun(
  input: AuthorizeExecutionRunInput,
): ExecutionRunAuthorization {
  if (input.execution.status !== "PENDING") {
    throw new ExecutionRunAuthorizationError(
      "EXECUTION_NOT_PENDING",
      `Cannot authorize execution with status: ${input.execution.status}.`,
    );
  }

  const decision = evaluatePolicy(input.policy, {
    decisionId: input.decisionId,
    action: "EXECUTION_RUN",
    riskLevel: input.riskLevel,
    actorId: input.execution.actorId,
    missionId: input.execution.missionId,
    taskId: input.execution.taskId,
    agentId: input.execution.agentId,
    evaluatedAt: input.evaluatedAt,
  });

  if (decision.effect === "DENY") {
    throw new ExecutionRunAuthorizationError(
      "EXECUTION_RUN_DENIED",
      "Execution run was denied by policy.",
      decision,
    );
  }

  if (decision.effect === "ALLOW") {
    return {
      status: "AUTHORIZED",
      policyDecision: decision,
    };
  }

  return {
    status: "APPROVAL_REQUIRED",
    policyDecision: decision,
    approvalRequest: createApprovalRequest(decision, {
      id: input.approvalRequestId,
      requestedBy: input.requestedBy,
      requestedAt: input.requestedAt,
      missionId: input.execution.missionId,
      taskId: input.execution.taskId,
      executionId: input.execution.id,
      expiresAt: input.expiresAt,
    }),
  };
}
