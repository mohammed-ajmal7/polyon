import type { ActorId } from "../actor/ids";
import type { MissionId, MissionPlanProposalId, TaskId } from "./ids";

export interface MissionPlanProposal {
  readonly id: MissionPlanProposalId;

  readonly missionId: MissionId;
  readonly taskIds: readonly TaskId[];

  readonly rationale: string;
  readonly createdBy: ActorId;
  readonly createdAt: string;
}
