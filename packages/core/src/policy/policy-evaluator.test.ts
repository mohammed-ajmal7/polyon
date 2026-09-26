import { describe, expect, it } from "vitest";

import { evaluatePolicy } from "./policy-evaluator";

const basePolicy = {
  id: "policy-1",
  name: "Default Policy",
  description: "Test policy",
  approvalMode: "BALANCED" as const,
  rules: [],
  defaultEffect: "REQUIRE_APPROVAL" as const,
  enabled: true,
  createdAt: "2026-09-27T00:00:00.000Z",
  updatedAt: "2026-09-27T00:00:00.000Z",
};

const input = {
  decisionId: "decision-1",
  action: "READ" as const,
  riskLevel: "LOW" as const,
  evaluatedAt: "2026-09-27T01:00:00.000Z",
};

describe("evaluatePolicy", () => {
  it("uses the default effect when no rule matches", () => {
    const decision = evaluatePolicy(basePolicy, input);

    expect(decision.effect).toBe("REQUIRE_APPROVAL");
    expect(decision.reason).toBe("No policy rule matched; using the policy default effect.");
  });

  it("uses a matching rule instead of the default effect", () => {
    const policy = {
      ...basePolicy,
      defaultEffect: "DENY" as const,
      rules: [
        {
          priority: 10,
          action: "READ" as const,
          effect: "ALLOW" as const,
        },
      ],
    };

    const decision = evaluatePolicy(policy, input);

    expect(decision.effect).toBe("ALLOW");
  });

  it("uses the highest priority matching rule", () => {
    const policy = {
      ...basePolicy,
      rules: [
        {
          priority: 10,
          action: "READ" as const,
          effect: "DENY" as const,
        },
        {
          priority: 50,
          action: "READ" as const,
          effect: "ALLOW" as const,
        },
      ],
    };

    const decision = evaluatePolicy(policy, input);

    expect(decision.effect).toBe("ALLOW");
    expect(decision.reason).toBe("Matched policy rule with priority 50.");
  });

  it("matches a rule by risk level", () => {
    const policy = {
      ...basePolicy,
      rules: [
        {
          priority: 20,
          riskLevel: "LOW" as const,
          effect: "ALLOW" as const,
        },
      ],
    };

    const decision = evaluatePolicy(policy, input);

    expect(decision.effect).toBe("ALLOW");
  });

  it("requires all specified rule conditions to match", () => {
    const policy = {
      ...basePolicy,
      rules: [
        {
          priority: 20,
          action: "WRITE" as const,
          riskLevel: "LOW" as const,
          effect: "ALLOW" as const,
        },
      ],
      defaultEffect: "DENY" as const,
    };

    const decision = evaluatePolicy(policy, input);

    expect(decision.effect).toBe("DENY");
  });

  it("allows a rule without conditions to match every action", () => {
    const policy = {
      ...basePolicy,
      rules: [
        {
          priority: 20,
          effect: "ALLOW" as const,
        },
      ],
    };

    const decision = evaluatePolicy(policy, input);

    expect(decision.effect).toBe("ALLOW");
  });

  it("denies actions when the policy is disabled", () => {
    const policy = {
      ...basePolicy,
      enabled: false,
      defaultEffect: "ALLOW" as const,
    };

    const decision = evaluatePolicy(policy, input);

    expect(decision.effect).toBe("DENY");
    expect(decision.reason).toBe("Policy is disabled.");
  });

  it("preserves the evaluation metadata", () => {
    const decision = evaluatePolicy(basePolicy, input);

    expect(decision.id).toBe("decision-1");
    expect(decision.policyId).toBe("policy-1");
    expect(decision.action).toBe("READ");
    expect(decision.riskLevel).toBe("LOW");
    expect(decision.evaluatedAt).toBe("2026-09-27T01:00:00.000Z");
  });
});
