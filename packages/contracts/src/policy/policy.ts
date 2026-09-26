import type { PolicyDecisionId, PolicyId } from "./ids";
import type { ActionKind, RiskLevel } from "./risk";

export type ApprovalMode = "ASK_EVERYTHING" | "BALANCED" | "AUTO";

export type PolicyEffect = "ALLOW" | "DENY" | "REQUIRE_APPROVAL";

export interface PolicyRule {
  readonly priority: number;
  readonly action?: ActionKind;
  readonly riskLevel?: RiskLevel;
  readonly effect: PolicyEffect;
}

export interface Policy {
  readonly id: PolicyId;
  readonly name: string;
  readonly description: string;

  readonly approvalMode: ApprovalMode;

  readonly rules: readonly PolicyRule[];
  readonly defaultEffect: PolicyEffect;

  readonly enabled: boolean;

  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface PolicyDecision {
  readonly id: PolicyDecisionId;

  readonly policyId: PolicyId;

  readonly action: ActionKind;
  readonly riskLevel: RiskLevel;

  readonly effect: PolicyEffect;

  readonly reason: string;

  readonly evaluatedAt: string;
}
