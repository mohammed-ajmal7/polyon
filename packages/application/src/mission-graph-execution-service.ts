import type {
  AgentId,
  Mission,
  Policy,
  Task,
} from "@polyon/contracts";

import type { ExecutionDispatchPlan } from "./execution-dispatch";
import type { ExecutionIdentityFactory, MissionExecutionService } from "./mission-execution-service";
import type { MissionStore, TaskStore } from "@polyon/storage";

export interface ExecuteMissionGraphInput {
  readonly missionId: string;
  readonly actorId: string;
  readonly agentId?: AgentId;
  readonly requiredCapabilityIds?: readonly string[];
  readonly policy: Policy;
  readonly riskLevel: "LOW" | "MEDIUM" | "HIGH";
  readonly now: string;
  readonly identities: ExecutionIdentityFactory;
}

export interface ExecuteMissionGraphResult {
  readonly mission: Mission;
  readonly tasks: readonly Task[];
  readonly dispatched: readonly ExecutionDispatchPlan[];
  readonly awaitingApproval: readonly ExecutionDispatchPlan[];
  readonly rejected: readonly ExecutionDispatchPlan[];
}

export class MissionGraphExecutionService {
  constructor(
    private readonly missions: MissionStore,
    private readonly tasks: TaskStore,
    private readonly execution: MissionExecutionService,
  ) {}

  executeReadyTasks(input: ExecuteMissionGraphInput): ExecuteMissionGraphResult {
    const mission = this.missions.get(input.missionId);
    if (mission === undefined) {
      throw new Error("Mission not found: " + input.missionId + ".");
    }

    const missionTasks = mission.taskIds
      .map((taskId) => this.tasks.get(taskId))
      .filter((task): task is Task => task !== undefined);

    const result = this.execution.dispatchReadyTasks({
      mission,
      tasks: missionTasks,
      actorId: input.actorId,
      ...(input.agentId === undefined ? {} : { agentId: input.agentId }),
      requiredCapabilityIds: input.requiredCapabilityIds,
      policy: input.policy,
      requestedBy: input.actorId,
      now: input.now,
      riskLevel: input.riskLevel,
      identities: input.identities,
    });

    const refreshedMission = this.missions.get(mission.id);
    if (refreshedMission === undefined) {
      throw new Error("Mission disappeared during graph execution.");
    }

    return {
      mission: refreshedMission,
      tasks: refreshedMission.taskIds
        .map((taskId) => this.tasks.get(taskId))
        .filter((task): task is Task => task !== undefined),
      dispatched: result.dispatched,
      awaitingApproval: result.awaitingApproval,
      rejected: result.rejected,
    };
  }
}
