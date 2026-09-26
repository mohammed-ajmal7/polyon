import type {
  ActorId,
  MissionId,
  MissionPlanProposal,
  MissionPlanProposalId,
  TaskId,
} from "@polyon/contracts";

export interface CreateMissionPlanProposalInput {
  readonly id: MissionPlanProposalId;
  readonly missionId: MissionId;
  readonly taskIds: readonly TaskId[];
  readonly rationale: string;
  readonly createdBy: ActorId;
  readonly createdAt: string;
}

export function createMissionPlanProposal(
  input: CreateMissionPlanProposalInput,
): MissionPlanProposal {
  return {
    id: input.id,
    missionId: input.missionId,
    taskIds: [...input.taskIds],
    rationale: input.rationale,
    createdBy: input.createdBy,
    createdAt: input.createdAt,
  };
}
