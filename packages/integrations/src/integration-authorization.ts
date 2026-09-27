import type {
  ActorId,
  ApprovalRequest,
  ApprovalRequestId,
  ExecutionId,
  MissionId,
  Policy,
  PolicyDecision,
  PolicyDecisionId,
  RiskLevel,
  TaskId,
} from "@polyon/contracts";

import { createApprovalRequest, evaluatePolicy } from "@polyon/core";

import type { IntegrationAdapter, IntegrationId } from "./integration-adapter";

export interface AuthorizeIntegrationInvocationInput {
  readonly integration: IntegrationAdapter;
  readonly integrationId?: IntegrationId;
  readonly invocationId?: string;
  readonly action: import("@polyon/contracts").ActionKind;
  readonly policy: Policy;
  readonly riskLevel: RiskLevel;

  readonly decisionId: PolicyDecisionId;
  readonly approvalRequestId: ApprovalRequestId;
  readonly requestedBy: ActorId;
  readonly requestedAt: string;
  readonly evaluatedAt: string;

  readonly actorId?: ActorId;
  readonly agentId?: import("@polyon/contracts").AgentId;
  readonly missionId?: MissionId;
  readonly taskId?: TaskId;
  readonly executionId?: ExecutionId;
  readonly expiresAt?: string;
}

export interface IntegrationInvocationAuthorization {
  readonly integrationId: IntegrationId;
  readonly status: "AUTHORIZED" | "APPROVAL_REQUIRED";
  readonly policyDecision: PolicyDecision;
  readonly approvalRequest?: ApprovalRequest;
}

export type IntegrationAuthorizationErrorKind =
  "INTEGRATION_ACTION_NOT_SUPPORTED" | "INTEGRATION_INVOCATION_DENIED";

export class IntegrationAuthorizationError extends Error {
  readonly kind: IntegrationAuthorizationErrorKind;
  readonly decision?: PolicyDecision;

  constructor(kind: IntegrationAuthorizationErrorKind, message: string, decision?: PolicyDecision) {
    super(message);
    this.name = "IntegrationAuthorizationError";
    this.kind = kind;
    this.decision = decision;
  }
}

export function authorizeIntegrationInvocation(
  input: AuthorizeIntegrationInvocationInput,
): IntegrationInvocationAuthorization {
  if (!input.integration.actionKinds.includes(input.action)) {
    throw new IntegrationAuthorizationError(
      "INTEGRATION_ACTION_NOT_SUPPORTED",
      "Integration does not support action: " + input.action + ".",
    );
  }

  const decision = evaluatePolicy(input.policy, {
    decisionId: input.decisionId,
    action: input.action,
    riskLevel: input.riskLevel,
    actorId: input.actorId,
    agentId: input.agentId,
    integrationId: input.integration.integrationId,
    missionId: input.missionId,
    taskId: input.taskId,
    evaluatedAt: input.evaluatedAt,
  });

  if (decision.effect === "DENY") {
    throw new IntegrationAuthorizationError(
      "INTEGRATION_INVOCATION_DENIED",
      "Integration invocation was denied by policy.",
      decision,
    );
  }

  if (decision.effect === "ALLOW") {
    return {
      integrationId: input.integration.integrationId,
      status: "AUTHORIZED",
      policyDecision: decision,
    };
  }

  return {
    integrationId: input.integration.integrationId,
    status: "APPROVAL_REQUIRED",
    policyDecision: decision,
    approvalRequest: createApprovalRequest(decision, {
      id: input.approvalRequestId,
      requestedBy: input.requestedBy,
      integrationId: input.integrationId ?? input.integration.integrationId,
      invocationId: input.invocationId,
      requestedAt: input.requestedAt,
      missionId: input.missionId,
      taskId: input.taskId,
      executionId: input.executionId,
      expiresAt: input.expiresAt,
    }),
  };
}
