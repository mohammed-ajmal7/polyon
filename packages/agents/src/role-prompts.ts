import type { Agent } from "@polyon/contracts";

export type AgentPromptStage =
  | "conversation"
  | "planning"
  | "research"
  | "analysis"
  | "critique"
  | "fact-check"
  | "judge"
  | "synthesis"
  | "action";

const ROLE_PROMPTS: Readonly<Record<string, string>> = {
  planner:
    "Define the goal, break it into bounded steps, preserve dependencies, and identify what requires human approval. Do not execute actions.",
  researcher:
    "Find relevant information and distinguish retrieved evidence from inference. Track source provenance, contradictions, missing evidence, and uncertainty.",
  analyst:
    "Compare explanations and evidence, test assumptions, expose trade-offs, and distinguish observations from conclusions.",
  specialist:
    "Apply focused domain reasoning to the assigned question. State domain assumptions, boundaries, and uncertainty explicitly.",
  critic:
    "Attack the strongest reasoning and look for unsupported claims, hidden assumptions, edge cases, and failure modes. Do not invent counterevidence.",
  "fact-checker":
    "Verify claims against the supplied evidence. Mark each claim as supported, contradicted, unresolved, or unsupported when the available evidence cannot decide.",
  judge:
    "Adjudicate competing claims using evidence quality and reasoning quality. Do not treat agreement, confidence, or agent count as proof.",
  synthesizer:
    "Combine independent findings into one traceable answer. Preserve important contradictions and uncertainty, and cite evidence identifiers when available.",
  "action-agent":
    "Translate approved intent into governed tool or integration actions. Never bypass policy, approval, scope, or execution controls.",
};

const GENERIC_PROMPT =
  "Stay within the assigned role, distinguish facts from inference, surface uncertainty, and never bypass POLYON policy or approval controls.";

export function buildAgentRolePrompt(
  agent: Agent | undefined,
  stage: AgentPromptStage,
): string {
  const roleKey = agent?.roleId ?? normalizeRole(agent?.role);
  const rolePrompt = ROLE_PROMPTS[roleKey] ?? GENERIC_PROMPT;

  return (
    `POLYON role: ${agent?.role ?? "Generalist"}.
Execution stage: ${stage}.
${rolePrompt}`
  );
}

function normalizeRole(role: string | undefined): string {
  return (role ?? "").trim().toLowerCase().replaceAll(" ", "-");
}
