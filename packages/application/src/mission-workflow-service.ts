import type { Mission, Policy } from "@polyon/contracts";
import { MissionCreationService } from "./mission-creation-service";
import { MissionLifecycleService } from "./mission-lifecycle-service";
import {
  MissionGraphExecutionService,
  type ExecuteMissionGraphResult,
} from "./mission-graph-execution-service";
import {
  MissionPlanOrchestrationService,
  type PlanMissionResult,
} from "./mission-plan-orchestration-service";
import type { ExecutionIdentityFactory } from "./mission-execution-service";

export type MissionWorkflowStatus = "PLAN_APPLIED" | "PLAN_APPROVAL_REQUIRED" | "PLAN_DENIED";
export interface ExecuteMissionWorkflowInput {
  readonly missionId: string;
  readonly conversationId: string;
  readonly objective: string;
  readonly constraints?: readonly string[];
  readonly actorId: string;
  readonly planningAgentId: string;
  readonly executionAgentId?: string;
  readonly requiredCapabilityIds: readonly string[];
  readonly policy: Policy;
  readonly riskLevel: "LOW" | "MEDIUM" | "HIGH";
  readonly proposalId: string;
  readonly decisionId: string;
  readonly approvalRequestId: string;
  readonly createdAt: string;
  readonly planningAt: string;
  readonly identities: ExecutionIdentityFactory;
}
export interface ExecuteMissionWorkflowResult {
  readonly status: MissionWorkflowStatus;
  readonly mission: Mission;
  readonly plan: PlanMissionResult;
  readonly execution?: ExecuteMissionGraphResult;
}
export class MissionWorkflowService {
  constructor(
    private readonly creation: MissionCreationService,
    private readonly lifecycle: MissionLifecycleService,
    private readonly planning: MissionPlanOrchestrationService,
    private readonly graph: MissionGraphExecutionService,
  ) {}
  async execute(input: ExecuteMissionWorkflowInput): Promise<ExecuteMissionWorkflowResult> {
    const created = this.creation.create({
      id: input.missionId,
      objective: input.objective,
      constraints: input.constraints,
      actorId: input.actorId,
      eventId: "MISSION_CREATED:" + input.missionId,
      conversationId: input.conversationId,
      createdAt: input.createdAt,
    });
    this.lifecycle.transition({
      missionId: created.mission.id,
      to: "PLANNING",
      actorId: input.actorId,
      eventId: "MISSION_STATUS_CHANGED:" + input.missionId + ":PLANNING",
      now: input.planningAt,
      causedByEventId: created.event.id,
    });
    let plan: Awaited<ReturnType<MissionPlanOrchestrationService["plan"]>>;
    try {
      plan = await this.planning.plan({
        missionId: created.mission.id,
        planningAgentId: input.planningAgentId,
        requiredCapabilityIds: input.requiredCapabilityIds,
        proposalId: input.proposalId,
        decisionId: input.decisionId,
        approvalRequestId: input.approvalRequestId,
        actorId: input.actorId,
        policy: input.policy,
        riskLevel: input.riskLevel,
        createdAt: input.createdAt,
        requestedAt: input.createdAt,
        evaluatedAt: input.planningAt,
      });
    } catch (error) {
      // Planning failed before a plan existed. Leaving the mission in PLANNING would strand it,
      // so hand it back to the human as WAITING, from which it can be planned again.
      this.lifecycle.transition({
        missionId: created.mission.id,
        to: "WAITING",
        actorId: input.actorId,
        eventId: "MISSION_STATUS_CHANGED:" + input.missionId + ":WAITING:planning-failed",
        now: input.planningAt,
      });
      throw error;
    }
    if (plan.submission.status === "APPROVAL_REQUIRED")
      return { status: "PLAN_APPROVAL_REQUIRED", mission: plan.mission, plan };
    if (plan.submission.status === "DENIED")
      return { status: "PLAN_DENIED", mission: plan.mission, plan };
    const execution = this.graph.executeReadyTasks({
      missionId: created.mission.id,
      actorId: input.actorId,
      ...(input.executionAgentId === undefined ? {} : { agentId: input.executionAgentId }),
      requiredCapabilityIds: input.requiredCapabilityIds,
      policy: input.policy,
      riskLevel: input.riskLevel,
      now: input.planningAt,
      identities: input.identities,
    });
    return { status: "PLAN_APPLIED", mission: execution.mission, plan, execution };
  }
}
