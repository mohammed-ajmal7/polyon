import type {
  ActorId,
  ApprovalRequest,
  Mission,
  MissionPlanProposal,
  Policy,
  PolicyDecision,
  RiskLevel,
  Task,
} from "@polyon/contracts";

import { createApprovalRequest, evaluatePolicy } from "../policy/index";
import {
  validateMissionPlanProposal,
  type MissionPlanProposalValidationError,
} from "./mission-plan-proposal-validation";

export interface AuthorizeMissionPlanApplicationInput {
  readonly proposal: MissionPlanProposal;
  readonly mission: Mission;
  readonly tasks: readonly Task[];
  readonly policy: Policy;
  readonly decisionId: string;
  readonly approvalRequestId: string;
  readonly requestedBy: ActorId;
  readonly requestedAt: string;
  readonly evaluatedAt: string;
  readonly riskLevel: RiskLevel;
  readonly expiresAt?: string;
}

export interface MissionPlanApplicationAuthorization {
  readonly status: "AUTHORIZED" | "APPROVAL_REQUIRED";
  readonly policyDecision: PolicyDecision;
  readonly approvalRequest?: ApprovalRequest;
}

export class InvalidMissionPlanApplicationError extends Error {
  readonly errors: readonly MissionPlanProposalValidationError[];

  constructor(errors: readonly MissionPlanProposalValidationError[]) {
    super("Cannot authorize invalid mission plan proposal.");
    this.name = "InvalidMissionPlanApplicationError";
    this.errors = errors;
  }
}

export class MissionPlanApplicationDeniedError extends Error {
  readonly decision: PolicyDecision;

  constructor(decision: PolicyDecision) {
    super("Mission plan application was denied by policy.");
    this.name = "MissionPlanApplicationDeniedError";
    this.decision = decision;
  }
}

export function authorizeMissionPlanApplication(
  input: AuthorizeMissionPlanApplicationInput,
): MissionPlanApplicationAuthorization {
  const validation = validateMissionPlanProposal(input.proposal, input.mission, input.tasks);

  if (!validation.valid) {
    throw new InvalidMissionPlanApplicationError(validation.errors);
  }

  const decision = evaluatePolicy(input.policy, {
    decisionId: input.decisionId,
    action: "PLAN_APPLY",
    riskLevel: input.riskLevel,
    evaluatedAt: input.evaluatedAt,
  });

  if (decision.effect === "DENY") {
    throw new MissionPlanApplicationDeniedError(decision);
  }

  if (decision.effect === "ALLOW") {
    return {
      status: "AUTHORIZED",
      policyDecision: decision,
    };
  }

  const approvalRequest = createApprovalRequest(decision, {
    id: input.approvalRequestId,
    requestedBy: input.requestedBy,
    requestedAt: input.requestedAt,
    missionId: input.mission.id,
    proposalId: input.proposal.id,
    expiresAt: input.expiresAt,
  });

  return {
    status: "APPROVAL_REQUIRED",
    policyDecision: decision,
    approvalRequest,
  };
}
