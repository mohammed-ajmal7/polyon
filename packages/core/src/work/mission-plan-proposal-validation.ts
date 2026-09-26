import type { Mission, MissionPlanProposal, Task, TaskId } from "@polyon/contracts";

import type { TaskGraphValidationError } from "./task-graph";
import { validateTaskGraph } from "./task-graph";

export type MissionPlanProposalValidationError =
  | {
      readonly kind: "PROPOSAL_MISSION_MISMATCH";
      readonly expectedMissionId: string;
      readonly actualMissionId: string;
    }
  | {
      readonly kind: "DUPLICATE_PROPOSAL_TASK_ID";
      readonly taskId: TaskId;
    }
  | {
      readonly kind: "MISSING_PROPOSAL_TASK";
      readonly taskId: TaskId;
    }
  | {
      readonly kind: "PROPOSAL_TASK_MISSION_MISMATCH";
      readonly taskId: TaskId;
      readonly expectedMissionId: string;
      readonly actualMissionId: string;
    }
  | TaskGraphValidationError;

export interface MissionPlanProposalValidationResult {
  readonly valid: boolean;
  readonly errors: readonly MissionPlanProposalValidationError[];
}

export function validateMissionPlanProposal(
  proposal: MissionPlanProposal,
  mission: Mission,
  tasks: readonly Task[],
): MissionPlanProposalValidationResult {
  const errors: MissionPlanProposalValidationError[] = [];

  if (proposal.missionId !== mission.id) {
    errors.push({
      kind: "PROPOSAL_MISSION_MISMATCH",
      expectedMissionId: mission.id,
      actualMissionId: proposal.missionId,
    });
  }

  const tasksById = new Map(tasks.map((task) => [task.id, task]));
  const seenTaskIds = new Set<TaskId>();
  const proposedTasks: Task[] = [];

  for (const taskId of proposal.taskIds) {
    if (seenTaskIds.has(taskId)) {
      errors.push({
        kind: "DUPLICATE_PROPOSAL_TASK_ID",
        taskId,
      });
      continue;
    }

    seenTaskIds.add(taskId);

    const task = tasksById.get(taskId);

    if (!task) {
      errors.push({
        kind: "MISSING_PROPOSAL_TASK",
        taskId,
      });
      continue;
    }

    if (task.missionId !== mission.id) {
      errors.push({
        kind: "PROPOSAL_TASK_MISSION_MISMATCH",
        taskId: task.id,
        expectedMissionId: mission.id,
        actualMissionId: task.missionId,
      });
      continue;
    }

    proposedTasks.push(task);
  }

  const graphResult = validateTaskGraph(proposedTasks);

  errors.push(...graphResult.errors);

  return {
    valid: errors.length === 0,
    errors,
  };
}
