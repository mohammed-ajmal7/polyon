import type {
  ActorId,
  ApprovalRequest,
  ApprovalRequestId,
  Execution,
  Policy,
  PolicyDecision,
  PolicyDecisionId,
  RiskLevel,
  Task,
} from "@polyon/contracts";

import type { TaskDependency } from "@polyon/core";

import {
  applyExecutionRunAuthorization,
  authorizeExecutionRun,
  createExecutionForTask,
  ExecutionRunAuthorizationError,
  rejectExecution,
} from "@polyon/core";

export interface PrepareExecutionDispatchInput {
  readonly task: Task;
  readonly dependencies: readonly TaskDependency[];
  readonly actorId: ActorId;
  readonly executionId: string;
  readonly attempt: number;

  readonly policy: Policy;
  readonly decisionId: PolicyDecisionId;
  readonly approvalRequestId: ApprovalRequestId;

  readonly requestedBy: ActorId;
  readonly requestedAt: string;
  readonly evaluatedAt: string;
  readonly riskLevel: RiskLevel;
  readonly expiresAt?: string;
}

export interface ExecutionDispatchPlan {
  readonly execution: Execution;
  readonly policyDecision: PolicyDecision;
  readonly approvalRequest?: ApprovalRequest;
  readonly nextStep: "ENQUEUE" | "AWAIT_APPROVAL" | "REJECTED";
}

export function prepareExecutionDispatch(
  input: PrepareExecutionDispatchInput,
): ExecutionDispatchPlan {
  const execution = createExecutionForTask(input.task, input.dependencies, {
    id: input.executionId,
    actorId: input.actorId,
    attempt: input.attempt,
    createdAt: input.requestedAt,
  });

  try {
    const authorization = authorizeExecutionRun({
      execution,
      policy: input.policy,
      decisionId: input.decisionId,
      approvalRequestId: input.approvalRequestId,
      requestedBy: input.requestedBy,
      requestedAt: input.requestedAt,
      evaluatedAt: input.evaluatedAt,
      riskLevel: input.riskLevel,
      expiresAt: input.expiresAt,
    });

    const updatedExecution = applyExecutionRunAuthorization(
      authorization,
      execution,
      input.evaluatedAt,
    );

    return {
      execution: updatedExecution,
      policyDecision: authorization.policyDecision,
      approvalRequest: authorization.approvalRequest,
      nextStep:
        authorization.status === "AUTHORIZED" ? "ENQUEUE" : "AWAIT_APPROVAL",
    };
  } catch (error) {
    if (
      error instanceof ExecutionRunAuthorizationError &&
      error.kind === "EXECUTION_RUN_DENIED" &&
      error.decision !== undefined
    ) {
      return {
        execution: rejectExecution(execution, input.evaluatedAt, error.decision.reason),
        policyDecision: error.decision,
        nextStep: "REJECTED",
      };
    }

    throw error;
  }
}
