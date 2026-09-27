import type { Debate } from "@polyon/contracts";

export type DebateValidationErrorKind =
  | "OBJECTIVE_REQUIRED"
  | "MAX_PARTICIPANTS_INVALID"
  | "MAX_ROUNDS_INVALID"
  | "PARTICIPANTS_BELOW_MINIMUM"
  | "PARTICIPANTS_EXCEED_MAXIMUM"
  | "DUPLICATE_PARTICIPANT";

export class DebateValidationError extends Error {
  readonly kind: DebateValidationErrorKind;

  constructor(kind: DebateValidationErrorKind, message: string) {
    super(message);
    this.name = "DebateValidationError";
    this.kind = kind;
  }
}

export function validateDebateDefinition(input: {
  readonly objective: string;
  readonly participantAgentIds: readonly string[];
  readonly maxParticipants: number;
  readonly maxRounds: number;
}): void {
  if (input.objective.trim() === "") {
    throw new DebateValidationError(
      "OBJECTIVE_REQUIRED",
      "A debate objective is required.",
    );
  }

  if (!Number.isInteger(input.maxParticipants) || input.maxParticipants < 2) {
    throw new DebateValidationError(
      "MAX_PARTICIPANTS_INVALID",
      "maxParticipants must be an integer greater than or equal to 2.",
    );
  }

  if (!Number.isInteger(input.maxRounds) || input.maxRounds < 1) {
    throw new DebateValidationError(
      "MAX_ROUNDS_INVALID",
      "maxRounds must be a positive integer.",
    );
  }

  if (input.participantAgentIds.length < 2) {
    throw new DebateValidationError(
      "PARTICIPANTS_BELOW_MINIMUM",
      "A debate requires at least two participants.",
    );
  }

  if (input.participantAgentIds.length > input.maxParticipants) {
    throw new DebateValidationError(
      "PARTICIPANTS_EXCEED_MAXIMUM",
      "Debate participants cannot exceed maxParticipants.",
    );
  }

  const uniqueParticipantIds = new Set(input.participantAgentIds);

  if (uniqueParticipantIds.size !== input.participantAgentIds.length) {
    throw new DebateValidationError(
      "DUPLICATE_PARTICIPANT",
      "Debate participants must be unique.",
    );
  }
}
