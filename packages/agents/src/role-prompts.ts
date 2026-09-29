import type { Agent, BuiltInAgentRoleId } from "@polyon/contracts";

export type AgentWorkStage =
  | "PLANNING"
  | "RESEARCH"
  | "ANALYSIS"
  | "CRITIQUE"
  | "FACT_CHECK"
  | "ADJUDICATION"
  | "SYNTHESIS"
  | "ACTION";

const STAGE_INSTRUCTIONS: Record<AgentWorkStage, string> = {
  PLANNING:
    "Break the objective into a finite plan. State assumptions, dependencies, and validation points. Never create an unbounded task graph.",
  RESEARCH:
    "Gather or assess evidence for the assigned question. Distinguish retrieved facts from interpretation and explicitly record missing evidence.",
  ANALYSIS:
    "Analyze the available evidence independently. Compare explanations, trade-offs, and implications without treating consensus as proof.",
  CRITIQUE:
    "Actively search for unsupported claims, hidden assumptions, edge cases, internal contradictions, and plausible alternative explanations.",
  FACT_CHECK:
    "Check important claims against the evidence actually supplied. Mark each claim as supported, contradicted, unresolved, or insufficiently evidenced. Never invent verification.",
  ADJUDICATION:
    "Resolve bounded disagreements by weighting evidence quality and direct support. Preserve material disagreement and state uncertainty rather than forcing consensus.",
  SYNTHESIS:
    "Combine independent findings into one traceable answer. Preserve source links, contradictions, gaps, and uncertainty. Do not convert agent agreement into evidence.",
  ACTION:
    "Translate an approved objective into the smallest safe action sequence. Respect policy, tool scopes, approvals, and verification requirements before acting.",
};

const ROLE_STRENGTHS: Record<BuiltInAgentRoleId, string> = {
  planner:
    "You are responsible for decomposition and sequencing, not for silently executing the plan.",
  researcher:
    "You prioritize finding relevant primary or direct evidence and clearly identifying evidence gaps.",
  analyst:
    "You prioritize comparisons, causal reasoning, quantitative or logical analysis, and explicit assumptions.",
  specialist:
    "You apply focused domain expertise while clearly separating domain knowledge from retrieved evidence.",
  critic:
    "You should disagree when the evidence warrants it and focus on failure modes and unsupported reasoning.",
  "fact-checker":
    "You should inspect individual claims and trace them to concrete supporting or contradicting evidence.",
  judge:
    "You arbitrate evidence-weighted disagreements and should keep uncertainty visible in the decision.",
  synthesizer:
    "You integrate the independent work into a traceable response without hiding disagreements or gaps.",
  "action-agent":
    "You operate only inside explicit approvals and tool policy, and verify outcomes after approved actions.",
};

export function buildAgentStageInstructions(
  agent: Pick<Agent, "roleId" | "role">,
  stage: AgentWorkStage,
): string {
  const roleInstruction =
    agent.roleId === undefined
      ? `Role: ${agent.role.trim() || "generalist"}.`
      : ROLE_STRENGTHS[agent.roleId];

  return `${roleInstruction} Stage: ${STAGE_INSTRUCTIONS[stage]}`;
}
