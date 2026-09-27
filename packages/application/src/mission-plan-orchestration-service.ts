import type {
  AgentId,
  Mission,
  Policy,
} from "@polyon/contracts";
import type { DomainUnitOfWork, MissionStore } from "@polyon/storage";

import type { MissionPlanService, MissionPlanServiceDependencies, MissionPlanSubmissionResult } from "./mission-plan-service";
import type { MissionPlanningService } from "./mission-planning-service";

export interface PlanMissionInput {
  readonly missionId: string;
  readonly planningAgentId: AgentId;
  readonly requiredCapabilityIds: readonly string[];
  readonly proposalId: string;
  readonly decisionId: string;
  readonly approvalRequestId: string;
  readonly actorId: string;
  readonly policy: Policy;
  readonly riskLevel: "LOW" | "MEDIUM" | "HIGH";
  readonly createdAt: string;
  readonly requestedAt: string;
  readonly evaluatedAt: string;
  readonly signal?: AbortSignal;
}

export interface PlanMissionResult {
  readonly mission: Mission;
  readonly submission: MissionPlanSubmissionResult;
}

export class MissionPlanOrchestrationService {
  constructor(
    private readonly missions: MissionStore,
    private readonly planner: MissionPlanningService,
    private readonly plans: MissionPlanService,
    private readonly taskOrchestration: {
      advanceReadyTasks(input: { missionId: string; actorId: string; now: string }): unknown;
    },
    private readonly unitOfWork?: DomainUnitOfWork,
  ) {}

  async plan(input: PlanMissionInput): Promise<PlanMissionResult> {
    const mission = this.missions.get(input.missionId);
    if (mission === undefined) throw new Error(`Mission not found: ${input.missionId}.`);

    const generated = await this.planner.generate({
      mission,
      planningAgentId: input.planningAgentId,
      requiredCapabilityIds: input.requiredCapabilityIds,
      now: input.createdAt,
      signal: input.signal,
    });

    const submission = this.plans.submit({
      missionId: mission.id,
      proposalId: input.proposalId,
      taskIds: generated.tasks.map((task) => task.id),
      rationale: generated.rationale,
      createdBy: input.planningAgentId,
      createdAt: input.createdAt,
      policy: input.policy,
      decisionId: input.decisionId,
      approvalRequestId: input.approvalRequestId,
      requestedBy: input.actorId,
      requestedAt: input.requestedAt,
      evaluatedAt: input.evaluatedAt,
      riskLevel: input.riskLevel,
    });

    if (submission.status === "APPLIED") {
      this.taskOrchestration.advanceReadyTasks({
        missionId: mission.id,
        actorId: input.actorId,
        now: input.evaluatedAt,
      });
    }

    const updatedMission = this.missions.get(mission.id);
    if (updatedMission === undefined) {
      throw new Error(`Mission disappeared after planning: ${mission.id}.`);
    }

    return {
      mission: updatedMission,
      submission,
    };
  }
}
