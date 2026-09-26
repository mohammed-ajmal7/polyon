import type {
  ActionKind,
  Policy,
  PolicyDecision,
  PolicyDecisionId,
  PolicyRule,
  RiskLevel,
} from "@polyon/contracts";

export interface PolicyEvaluationInput {
  readonly decisionId: PolicyDecisionId;
  readonly action: ActionKind;
  readonly riskLevel: RiskLevel;
  readonly evaluatedAt: string;
}

function matchesRule(rule: PolicyRule, action: ActionKind, riskLevel: RiskLevel): boolean {
  if (rule.action !== undefined && rule.action !== action) {
    return false;
  }

  if (rule.riskLevel !== undefined && rule.riskLevel !== riskLevel) {
    return false;
  }

  return true;
}

function selectMatchingRule(
  rules: readonly PolicyRule[],
  action: ActionKind,
  riskLevel: RiskLevel,
): PolicyRule | undefined {
  let selectedRule: PolicyRule | undefined;

  for (const rule of rules) {
    if (!matchesRule(rule, action, riskLevel)) {
      continue;
    }

    if (selectedRule === undefined || rule.priority > selectedRule.priority) {
      selectedRule = rule;
    }
  }

  return selectedRule;
}

export function evaluatePolicy(policy: Policy, input: PolicyEvaluationInput): PolicyDecision {
  if (!policy.enabled) {
    return {
      id: input.decisionId,
      policyId: policy.id,
      action: input.action,
      riskLevel: input.riskLevel,
      effect: "DENY",
      reason: "Policy is disabled.",
      evaluatedAt: input.evaluatedAt,
    };
  }

  const matchingRule = selectMatchingRule(policy.rules, input.action, input.riskLevel);

  if (matchingRule !== undefined) {
    return {
      id: input.decisionId,
      policyId: policy.id,
      action: input.action,
      riskLevel: input.riskLevel,
      effect: matchingRule.effect,
      reason: `Matched policy rule with priority ${matchingRule.priority}.`,
      evaluatedAt: input.evaluatedAt,
    };
  }

  return {
    id: input.decisionId,
    policyId: policy.id,
    action: input.action,
    riskLevel: input.riskLevel,
    effect: policy.defaultEffect,
    reason: "No policy rule matched; using the policy default effect.",
    evaluatedAt: input.evaluatedAt,
  };
}
