import type {
  ActorId,
  AgentId,
  ApprovalRequest,
  CapabilityId,
  ApprovalRequestId,
  Execution,
  Policy,
  PolicyDecision,
  PolicyDecisionId,
  RiskLevel,
  Task,
} from "@polyon/contracts";
import {
  bindExecutionRouting,
  type BoundExecutionRouting,
  type ExecutionRoutingRegistries,
} from "@polyon/agents";

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
  readonly agentId?: AgentId;
  readonly requiredCapabilityIds?: readonly CapabilityId[];
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
  readonly routing?: BoundExecutionRouting;
  readonly nextStep: "ENQUEUE" | "AWAIT_APPROVAL" | "REJECTED";
}

export function prepareExecutionDispatch(
  input: PrepareExecutionDispatchInput,
  routing?: ExecutionRoutingRegistries,
): ExecutionDispatchPlan {
  const execution = createExecutionForTask(input.task, input.dependencies, {
    id: input.executionId,
    actorId: input.actorId,
    agentId: input.agentId,
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

    const authorizedExecution = applyExecutionRunAuthorization(
      authorization,
      execution,
      input.evaluatedAt,
    );
    const boundRouting =
      input.agentId === undefined || routing === undefined
        ? undefined
        : bindExecutionRouting(
            {
              execution: authorizedExecution,
              agentId: input.agentId,
              requiredCapabilityIds: input.requiredCapabilityIds ?? [],
              boundAt: input.evaluatedAt,
            },
            routing,
          );

    return {
      execution: boundRouting?.execution ?? authorizedExecution,
      policyDecision: authorization.policyDecision,
      approvalRequest: authorization.approvalRequest,
      ...(boundRouting === undefined ? {} : { routing: boundRouting }),
      nextStep: authorization.status === "AUTHORIZED" ? "ENQUEUE" : "AWAIT_APPROVAL",
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
