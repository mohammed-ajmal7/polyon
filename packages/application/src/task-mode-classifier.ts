import type { AgentRunMode } from "@polyon/contracts";

export interface TaskModeClassification {
  readonly mode: AgentRunMode;
  readonly reason: string;
}

const DEEP_PATTERNS: readonly RegExp[] = [
  /\binvestigat/i,
  /\banaly[sz]/i,
  /\bdeep(?:ly)?\b/i,
  /\bdebate\b/i,
  /\broot cause\b/i,
  /\bwhy (?:did|does|do|is|are|was|were|has|have)\b/i,
  /\bpros and cons\b/i,
  /\bcompare\b/i,
  /\bevaluate\b/i,
  /\bverify\b/i,
  /\bfact[- ]?check/i,
  /\beveryone\b/i,
  /\bthe (?:whole )?team\b/i,
];

const RESEARCH_PATTERNS: readonly RegExp[] = [
  /\bresearch\b/i,
  /\bsources?\b/i,
  /\blatest\b/i,
  /\bnews\b/i,
  /\bfind out\b/i,
  /\blook up\b/i,
  /\bwhat happened\b/i,
  /\bcurrent (?:events|price|state|status)\b/i,
];

/**
 * Chooses how much of POLYON to involve for a request, so the user does not have to pick an
 * orchestration mode. Deterministic and cheap by design: it runs before any model call.
 */
export function classifyTaskMode(command: string): TaskModeClassification {
  const text = command.trim();

  const deep = DEEP_PATTERNS.find((pattern) => pattern.test(text));
  if (deep !== undefined) {
    return {
      mode: "deep",
      reason: "The request asks for investigation, comparison or verification.",
    };
  }

  const research = RESEARCH_PATTERNS.find((pattern) => pattern.test(text));
  if (research !== undefined) {
    return { mode: "research", reason: "The request depends on current or sourced information." };
  }

  return { mode: "simple", reason: "The request can be answered directly." };
}
