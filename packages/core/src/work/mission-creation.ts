import type { Mission, MissionId } from "@polyon/contracts";

export type MissionCreationErrorKind = "OBJECTIVE_REQUIRED";

export class MissionCreationError extends Error {
  readonly kind: MissionCreationErrorKind;

  constructor(kind: MissionCreationErrorKind, message: string) {
    super(message);
    this.name = "MissionCreationError";
    this.kind = kind;
  }
}

export interface CreateMissionInput {
  readonly id: MissionId;
  readonly objective: string;
  readonly constraints: readonly string[];
  readonly createdAt: string;
}

export function createMission(input: CreateMissionInput): Mission {
  if (input.objective.trim() === "") {
    throw new MissionCreationError("OBJECTIVE_REQUIRED", "A mission objective is required.");
  }

  return {
    id: input.id,
    objective: input.objective,
    constraints: [...input.constraints],
    status: "DRAFT",
    taskIds: [],
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
  };
}
