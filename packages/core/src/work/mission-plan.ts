import type { Mission, Task } from "@polyon/contracts";

import type { TaskGraphValidationError } from "./task-graph";
import { validateTaskGraph } from "./task-graph";

export type MissionPlanValidationError =
  | {
      readonly kind: "DUPLICATE_MISSION_TASK_ID";
      readonly taskId: string;
    }
  | {
      readonly kind: "MISSING_MISSION_TASK";
      readonly taskId: string;
    }
  | {
      readonly kind: "UNDECLARED_MISSION_TASK";
      readonly taskId: string;
    }
  | {
      readonly kind: "TASK_MISSION_MISMATCH";
      readonly taskId: string;
      readonly expectedMissionId: string;
      readonly actualMissionId: string;
    }
  | TaskGraphValidationError;

export interface MissionPlanValidationResult {
  readonly valid: boolean;
  readonly errors: readonly MissionPlanValidationError[];
}

export function validateMissionTaskPlan(
  mission: Mission,
  tasks: readonly Task[],
): MissionPlanValidationResult {
  const errors: MissionPlanValidationError[] = [];
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  const missionTaskIds = new Set<string>();

  for (const taskId of mission.taskIds) {
    if (missionTaskIds.has(taskId)) {
      errors.push({
        kind: "DUPLICATE_MISSION_TASK_ID",
        taskId,
      });
      continue;
    }

    missionTaskIds.add(taskId);

    if (!taskById.has(taskId)) {
      errors.push({
        kind: "MISSING_MISSION_TASK",
        taskId,
      });
    }
  }

  for (const task of tasks) {
    if (task.missionId !== mission.id) {
      errors.push({
        kind: "TASK_MISSION_MISMATCH",
        taskId: task.id,
        expectedMissionId: mission.id,
        actualMissionId: task.missionId,
      });
      continue;
    }

    if (!missionTaskIds.has(task.id)) {
      errors.push({
        kind: "UNDECLARED_MISSION_TASK",
        taskId: task.id,
      });
    }
  }

  const graphResult = validateTaskGraph(tasks);

  errors.push(...graphResult.errors);

  return {
    valid: errors.length === 0,
    errors,
  };
}
