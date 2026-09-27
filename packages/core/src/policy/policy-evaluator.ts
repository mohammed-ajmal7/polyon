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
  readonly actorId?: import("@polyon/contracts").ActorId;
  readonly missionId?: import("@polyon/contracts").MissionId;
  readonly taskId?: import("@polyon/contracts").TaskId;
  readonly agentId?: import("@polyon/contracts").AgentId;
  readonly capabilityId?: import("@polyon/contracts").CapabilityId;
  readonly toolId?: import("@polyon/contracts").ToolId;
  readonly evaluatedAt: string;
}

function matchesRule(
  rule: PolicyRule,
  input: PolicyEvaluationInput,
): boolean {
  if (rule.actorId !== undefined && rule.actorId !== input.actorId) {
    return false;
  }

  if (rule.missionId !== undefined && rule.missionId !== input.missionId) {
    return false;
  }

  if (rule.taskId !== undefined && rule.taskId !== input.taskId) {
    return false;
  }

  if (rule.agentId !== undefined && rule.agentId !== input.agentId) {
    return false;
  }

  if (rule.capabilityId !== undefined && rule.capabilityId !== input.capabilityId) {
    return false;
  }

  if (rule.toolId !== undefined && rule.toolId !== input.toolId) {
    return false;
  }

  if (rule.action !== undefined && rule.action !== input.action) {
    return false;
  }

  if (rule.riskLevel !== undefined && rule.riskLevel !== input.riskLevel) {
    return false;
  }

  return true;
}

function selectMatchingRule(
  rules: readonly PolicyRule[],
  input: PolicyEvaluationInput,
): PolicyRule | undefined {
  let selectedRule: PolicyRule | undefined;

  for (const rule of rules) {
    if (!matchesRule(rule, input)) {
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

  const matchingRule = selectMatchingRule(policy.rules, input);

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
