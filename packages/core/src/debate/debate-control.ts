import type { Debate } from "@polyon/contracts";

import { validateDebateDefinition } from "./debate-validation";
import { canTransitionDebate } from "./debate-lifecycle";
import { InvalidStateTransitionError } from "../work/transition-error";

const phaseTransitions = {
  PROPOSAL: "CRITICISM",
  CRITICISM: "EVIDENCE",
  EVIDENCE: "REBUTTAL",
} as const;

export class DebateControlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DebateControlError";
  }
}

export function createDebate(input: {
  readonly id: string;
  readonly objective: string;
  readonly participantAgentIds: readonly string[];
  readonly maxParticipants: number;
  readonly maxRounds: number;
  readonly createdAt: string;
}): Debate {
  validateDebateDefinition(input);

  return {
    id: input.id,
    objective: input.objective,
    participantAgentIds: [...input.participantAgentIds],
    maxParticipants: input.maxParticipants,
    maxRounds: input.maxRounds,
    currentRound: 0,
    phase: "PROPOSAL",
    status: "DRAFT",
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
  };
}

export function startDebate(debate: Debate, startedAt: string): Debate {
  if (!canTransitionDebate(debate.status, "RUNNING")) {
    throw new InvalidStateTransitionError("debate", debate.status, "RUNNING");
  }

  return {
    ...debate,
    currentRound: 1,
    phase: "PROPOSAL",
    status: "RUNNING",
    updatedAt: startedAt,
  };
}

export function advanceDebatePhase(debate: Debate, now: string): Debate {
  if (debate.status !== "RUNNING") {
    throw new DebateControlError(`Cannot advance debate while status is ${debate.status}.`);
  }

  if (debate.phase === "REBUTTAL") {
    if (debate.currentRound < debate.maxRounds) {
      return {
        ...debate,
        currentRound: debate.currentRound + 1,
        phase: "PROPOSAL",
        updatedAt: now,
      };
    }

    return {
      ...debate,
      phase: "ADJUDICATION",
      status: "ADJUDICATING",
      updatedAt: now,
    };
  }

  if (debate.phase === "ADJUDICATION") {
    throw new DebateControlError("An adjudication phase cannot be advanced from RUNNING status.");
  }

  return {
    ...debate,
    phase: phaseTransitions[debate.phase],
    updatedAt: now,
  };
}

export function decideDebate(debate: Debate, decidedAt: string): Debate {
  if (!canTransitionDebate(debate.status, "DECIDED")) {
    throw new InvalidStateTransitionError("debate", debate.status, "DECIDED");
  }

  if (debate.phase !== "ADJUDICATION") {
    throw new DebateControlError("A debate can only be decided during adjudication.");
  }

  return {
    ...debate,
    status: "DECIDED",
    decidedAt,
    updatedAt: decidedAt,
  };
}

export function cancelDebate(debate: Debate, cancelledAt: string): Debate {
  if (!canTransitionDebate(debate.status, "CANCELLED")) {
    throw new InvalidStateTransitionError("debate", debate.status, "CANCELLED");
  }

  return {
    ...debate,
    status: "CANCELLED",
    updatedAt: cancelledAt,
  };
}
