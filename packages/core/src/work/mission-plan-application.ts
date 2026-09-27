import type { Mission, MissionPlanProposal, Task } from "@polyon/contracts";

import {
  validateMissionPlanProposal,
  type MissionPlanProposalValidationError,
} from "./mission-plan-proposal-validation";

export class InvalidMissionPlanProposalError extends Error {
  readonly errors: readonly MissionPlanProposalValidationError[];

  constructor(errors: readonly MissionPlanProposalValidationError[]) {
    super("Cannot apply invalid mission plan proposal.");
    this.name = "InvalidMissionPlanProposalError";
    this.errors = errors;
  }
}

export function applyMissionPlanProposal(
  proposal: MissionPlanProposal,
  mission: Mission,
  tasks: readonly Task[],
  updatedAt = new Date().toISOString(),
): Mission {
  const validation = validateMissionPlanProposal(proposal, mission, tasks);

  if (!validation.valid) {
    throw new InvalidMissionPlanProposalError(validation.errors);
  }

  return {
    ...mission,
    taskIds: [...proposal.taskIds],
    updatedAt,
  };
}
