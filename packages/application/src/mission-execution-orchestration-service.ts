import type {
  AgentId,
  Conversation,
  Mission,
  Policy,
  Task,
  TaskKind,
} from "@polyon/contracts";

import {
  MissionCreationService,
  MissionExecutionService,
  MissionLifecycleService,
  MissionPlanService,
  type ExecutionIdentityFactory,
  type SubmitMissionPlanInput,
} from "@polyon/application";
import type {
  ActorId,
  EventId,
  MissionId,
  MissionPlanProposalId,
  PolicyDecisionId,
  ApprovalRequestId,
  TaskId,
} from "@polyon/contracts";
import type { CommandIngressResult } from "./command-ingress";
import type { DomainUnitOfWork, DomainStoreTransactionContext } from "@polyon/storage";

export interface MissionExecutionOrchestrationInput {
  readonly command: CommandIngressResult;
  readonly missionId: MissionId;
  readonly taskIdFactory: (missionId: MissionId) => TaskId;
  readonly taskKind?: TaskKind;
  readonly taskTitle?: string;
  readonly taskDescription?: string;
  readonly proposalId: MissionPlanProposalId;
  readonly decisionId: PolicyDecisionId;
  readonly approvalRequestId: ApprovalRequestId;
  readonly missionCreatedEventId: EventId;
  readonly planningEventId: EventId;
  readonly runningEventId: EventId;
  readonly planCreatedAt: string;
  readonly planningAt: string;
  readonly taskCreatedAt: string;
  readonly runningAt: string;
  readonly actorId: ActorId;
  readonly planningAgentId: AgentId;
  readonly executionAgentId?: AgentId;
  readonly requiredCapabilityIds?: readonly string[];
  readonly policy: Policy;
  readonly riskLevel: "LOW" | "MEDIUM" | "HIGH";
  readonly identities: ExecutionIdentityFactory;
}

export type MissionExecutionOrchestrationStatus =
  | "QUEUED"
  | "PLAN_APPROVAL_REQUIRED"
  | "PLAN_DENIED";

export interface MissionExecutionOrchestrationResult {
  readonly status: MissionExecutionOrchestrationStatus;
  readonly mission: Mission;
  readonly conversation: Conversation;
  readonly task: Task;
  readonly executionIds: readonly string[];
}

export class MissionExecutionOrchestrationService {
  constructor(
    private readonly creation: MissionCreationService,
    private readonly lifecycle: MissionLifecycleService,
    private readonly plans: MissionPlanService,
    private readonly execution: MissionExecutionService,
    private readonly tasks: {
      save(task: Task): void;
      get(taskId: TaskId): Task | undefined;
    },
  ) {}

  orchestrate(input: MissionExecutionOrchestrationInput): MissionExecutionOrchestrationResult {
    if (input.command.message.actorId !== input.actorId) {
      throw new Error("Command actor and orchestration actor must match.");
    }

    const created = this.creation.create({
      id: input.missionId,
      objective: input.command.message.content,
      actorId: input.actorId,
      eventId: input.missionCreatedEventId,
      conversationId: input.command.conversation.id,
      createdAt: input.planCreatedAt,
    });

    const planning = this.lifecycle.transition({
      missionId: created.mission.id,
      to: "PLANNING",
      actorId: input.actorId,
      eventId: input.planningEventId,
      now: input.planningAt,
      causedByEventId: created.event.id,
    });

    const task: Task = {
      id: input.taskIdFactory(created.mission.id),
      missionId: created.mission.id,
      kind: input.taskKind ?? "OTHER",
      title: input.taskTitle?.trim() || "Execute mission objective",
      description: input.taskDescription?.trim() || created.mission.objective,
      status: "PENDING",
      dependsOn: [],
      createdAt: input.taskCreatedAt,
      updatedAt: input.taskCreatedAt,
    };
    this.tasks.save(task);

    const planned = this.plans.submit({
      missionId: created.mission.id,
      proposalId: input.proposalId,
      taskIds: [task.id],
      rationale: "Bounded initial execution plan created from the accepted mission command.",
      createdBy: input.planningAgentId,
      createdAt: input.planCreatedAt,
      policy: input.policy,
      decisionId: input.decisionId,
      approvalRequestId: input.approvalRequestId,
      requestedBy: input.actorId,
      requestedAt: input.planCreatedAt,
      evaluatedAt: input.planningAt,
      riskLevel: input.riskLevel,
    } satisfies SubmitMissionPlanInput);

    if (planned.status === "DENIED") {
      return {
        status: "PLAN_DENIED",
        mission: planned.mission,
        conversation: created.conversation,
        task,
        executionIds: [],
      };
    }

    if (planned.status === "APPROVAL_REQUIRED") {
      return {
        status: "PLAN_APPROVAL_REQUIRED",
        mission: planned.mission,
        conversation: created.conversation,
        task,
        executionIds: [],
      };
    }

    const running = this.lifecycle.transition({
      missionId: created.mission.id,
      to: "RUNNING",
      actorId: input.actorId,
      eventId: input.runningEventId,
      now: input.runningAt,
      causedByEventId: planned.events[planned.events.length - 1]?.id,
    });

    const dispatched = this.execution.dispatchReadyTasks({
      mission: running.mission,
      tasks: [task],
      actorId: input.actorId,
      ...(input.executionAgentId === undefined ? {} : { agentId: input.executionAgentId }),
      requiredCapabilityIds: input.requiredCapabilityIds,
      policy: input.policy,
      requestedBy: input.actorId,
      now: input.runningAt,
      riskLevel: input.riskLevel,
      identities: input.identities,
    });

    return {
      status: dispatched.dispatched.length > 0 ? "QUEUED" : "PLAN_DENIED",
      mission: running.mission,
      conversation: created.conversation,
      task: this.tasks.get(task.id) ?? task,
      executionIds: dispatched.dispatched.map((plan) => plan.execution.id),
    };
  }
}
