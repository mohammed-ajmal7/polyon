import type { DebateStatus } from "@polyon/contracts";

const transitions: Readonly<Record<DebateStatus, readonly DebateStatus[]>> = {
  DRAFT: ["RUNNING", "CANCELLED"],
  RUNNING: ["ADJUDICATING", "CANCELLED"],
  ADJUDICATING: ["DECIDED", "CANCELLED"],
  DECIDED: [],
  CANCELLED: [],
};

export function canTransitionDebate(
  from: DebateStatus,
  to: DebateStatus,
): boolean {
  return transitions[from].includes(to);
}
