import type { CapabilityId } from "./ids";

export type BuiltInAgentRoleId =
  | "planner"
  | "researcher"
  | "analyst"
  | "specialist"
  | "critic"
  | "fact-checker"
  | "judge"
  | "synthesizer"
  | "action-agent";

export interface BuiltInAgentRoleDefinition {
  readonly id: BuiltInAgentRoleId;
  readonly name: string;
  readonly description: string;
  readonly defaultCapabilityIds: readonly CapabilityId[];
}

export const BUILT_IN_AGENT_ROLES: readonly BuiltInAgentRoleDefinition[] = [
  {
    id: "planner",
    name: "Planner",
    description: "Breaks user goals into bounded, executable plans.",
    defaultCapabilityIds: ["ai.chat", "ai.reasoning", "ai.structured-output"],
  },
  {
    id: "researcher",
    name: "Researcher",
    description: "Finds relevant facts, sources, context, and information gaps.",
    defaultCapabilityIds: ["ai.chat", "ai.reasoning", "ai.tool-calling"],
  },
  {
    id: "analyst",
    name: "Analyst",
    description: "Compares evidence, explanations, patterns, and implications.",
    defaultCapabilityIds: ["ai.chat", "ai.reasoning"],
  },
  {
    id: "specialist",
    name: "Specialist",
    description: "Applies focused domain expertise to a bounded problem.",
    defaultCapabilityIds: ["ai.chat", "ai.reasoning"],
  },
  {
    id: "critic",
    name: "Critic",
    description: "Challenges assumptions, reasoning, edge cases, and unsupported claims.",
    defaultCapabilityIds: ["ai.chat", "ai.reasoning", "ai.structured-output"],
  },
  {
    id: "fact-checker",
    name: "Fact Checker",
    description: "Tests claims against supplied evidence and identifies verification gaps.",
    defaultCapabilityIds: ["ai.chat", "ai.reasoning", "ai.tool-calling"],
  },
  {
    id: "judge",
    name: "Judge",
    description: "Adjudicates bounded disagreements and records uncertainty.",
    defaultCapabilityIds: ["ai.chat", "ai.reasoning", "ai.structured-output"],
  },
  {
    id: "synthesizer",
    name: "Synthesizer",
    description: "Combines independent findings into a traceable final response.",
    defaultCapabilityIds: ["ai.chat", "ai.reasoning", "ai.structured-output", "ai.long-context"],
  },
  {
    id: "action-agent",
    name: "Action Agent",
    description: "Executes approved actions through governed tools and integrations.",
    defaultCapabilityIds: ["ai.chat", "ai.reasoning", "ai.tool-calling", "ai.structured-output"],
  },
];

const ROLE_BY_ID = new Map(BUILT_IN_AGENT_ROLES.map((role) => [role.id, role]));

export function getBuiltInAgentRole(
  id: BuiltInAgentRoleId,
): BuiltInAgentRoleDefinition | undefined {
  return ROLE_BY_ID.get(id);
}
