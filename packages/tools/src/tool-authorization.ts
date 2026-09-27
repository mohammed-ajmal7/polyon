import type {
  ActorId,
  ActionKind,
  AgentId,
  ApprovalRequest,
  ApprovalRequestId,
  ExecutionId,
  MissionId,
  Policy,
  PolicyDecision,
  PolicyDecisionId,
  TaskId,
  Tool,
  RiskLevel,
} from "@polyon/contracts";

import { createApprovalRequest, evaluatePolicy } from "@polyon/core";

export interface AuthorizeToolInvocationInput {
  readonly tool: Tool;
  readonly policy: Policy;
  readonly action: ActionKind;
  readonly riskLevel: RiskLevel;

  readonly decisionId: PolicyDecisionId;
  readonly approvalRequestId: ApprovalRequestId;
  readonly requestedBy: ActorId;
  readonly requestedAt: string;
  readonly evaluatedAt: string;

  readonly actorId?: ActorId;
  readonly missionId?: MissionId;
  readonly taskId?: TaskId;
  readonly executionId?: ExecutionId;
  readonly invocationId?: string;
  readonly agentId?: AgentId;
  readonly expiresAt?: string;
}

export interface ToolInvocationAuthorization {
  readonly status: "AUTHORIZED" | "APPROVAL_REQUIRED";
  readonly policyDecision: PolicyDecision;
  readonly approvalRequest?: ApprovalRequest;
}

export type ToolAuthorizationErrorKind =
  "TOOL_DISABLED" | "TOOL_ACTION_NOT_SUPPORTED" | "TOOL_INVOCATION_DENIED";

export class ToolAuthorizationError extends Error {
  readonly kind: ToolAuthorizationErrorKind;
  readonly decision?: PolicyDecision;

  constructor(kind: ToolAuthorizationErrorKind, message: string, decision?: PolicyDecision) {
    super(message);
    this.name = "ToolAuthorizationError";
    this.kind = kind;
    this.decision = decision;
  }
}

export function authorizeToolInvocation(
  input: AuthorizeToolInvocationInput,
): ToolInvocationAuthorization {
  if (!input.tool.enabled) {
    throw new ToolAuthorizationError(
      "TOOL_DISABLED",
      `Cannot invoke disabled tool: ${input.tool.id}.`,
    );
  }

  if (!input.tool.actionKinds.includes(input.action)) {
    throw new ToolAuthorizationError(
      "TOOL_ACTION_NOT_SUPPORTED",
      `Tool ${input.tool.id} does not support action: ${input.action}.`,
    );
  }

  const decision = evaluatePolicy(input.policy, {
    decisionId: input.decisionId,
    action: input.action,
    riskLevel: input.riskLevel,
    actorId: input.actorId,
    missionId: input.missionId,
    taskId: input.taskId,
    agentId: input.agentId,
    toolId: input.tool.id,
    evaluatedAt: input.evaluatedAt,
  });

  if (decision.effect === "DENY") {
    throw new ToolAuthorizationError(
      "TOOL_INVOCATION_DENIED",
      "Tool invocation was denied by policy.",
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
      missionId: input.missionId,
      taskId: input.taskId,
      executionId: input.executionId,
      toolId: input.tool.id,
      invocationId: input.invocationId,
      expiresAt: input.expiresAt,
    }),
  };
}
