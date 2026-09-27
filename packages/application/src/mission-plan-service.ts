import type {
  ActorId,
  ApprovalRequest,
  DomainEvent,
  EventId,
  Mission,
  MissionPlanProposal,
  MissionPlanProposalId,
  Policy,
  PolicyDecision,
  RiskLevel,
  Task,
} from "@polyon/contracts";
import {
  applyApprovedMissionPlanProposal,
  applyMissionPlanProposal,
  authorizeMissionPlanApplication,
  createMissionPlanProposal,
  MissionPlanApplicationDeniedError,
  transitionApprovalStatus,
} from "@polyon/core";
import type {
  ApprovalRequestStore,
  DomainStoreTransactionContext,
  DomainUnitOfWork,
  EventStore,
  MissionPlanProposalStore,
  MissionStore,
  PolicyDecisionStore,
  TaskStore,
} from "@polyon/storage";

export interface MissionPlanServiceDependencies {
  readonly missions: MissionStore;
  readonly tasks: TaskStore;
  readonly proposals: MissionPlanProposalStore;
  readonly policyDecisions: PolicyDecisionStore;
  readonly approvals: ApprovalRequestStore;
  readonly events: EventStore;
  readonly unitOfWork?: DomainUnitOfWork;
}

type MissionPlanStores = {
  readonly missions: MissionStore;
  readonly tasks: TaskStore;
  readonly proposals: MissionPlanProposalStore;
  readonly policyDecisions: PolicyDecisionStore;
  readonly approvals: ApprovalRequestStore;
  readonly events: EventStore;
};

export interface SubmitMissionPlanInput {
  readonly missionId: string;
  readonly proposalId: MissionPlanProposalId;
  readonly taskIds: readonly string[];
  readonly rationale: string;
  readonly createdBy: ActorId;
  readonly createdAt: string;
  readonly policy: Policy;
  readonly decisionId: string;
  readonly approvalRequestId: string;
  readonly requestedBy: ActorId;
  readonly requestedAt: string;
  readonly evaluatedAt: string;
  readonly appliedAt?: string;
  readonly riskLevel: RiskLevel;
  readonly expiresAt?: string;
}

export type MissionPlanSubmissionStatus = "APPLIED" | "APPROVAL_REQUIRED" | "DENIED";

export interface MissionPlanSubmissionResult {
  readonly status: MissionPlanSubmissionStatus;
  readonly mission: Mission;
  readonly proposal: MissionPlanProposal;
  readonly policyDecision: PolicyDecision;
  readonly approvalRequest?: ApprovalRequest;
  readonly events: readonly DomainEvent[];
}

export interface ResolveMissionPlanApprovalInput {
  readonly approvalId: string;
  readonly status: "APPROVED" | "REJECTED" | "EXPIRED" | "CANCELLED";
  readonly resolvedAt: string;
  readonly resolvedBy?: ActorId;
}

export type MissionPlanApprovalResolutionStatus = "APPLIED" | "REJECTED" | "EXPIRED" | "CANCELLED";

export interface MissionPlanApprovalResolution {
  readonly status: MissionPlanApprovalResolutionStatus;
  readonly approval: ApprovalRequest;
  readonly mission: Mission;
  readonly proposal: MissionPlanProposal;
  readonly events: readonly DomainEvent[];
}

export type MissionPlanServiceErrorKind =
  | "MISSION_NOT_FOUND"
  | "MISSION_NOT_PLANNING"
  | "PROPOSAL_EXISTS"
  | "POLICY_DECISION_EXISTS"
  | "APPROVAL_EXISTS"
  | "APPROVAL_NOT_FOUND"
  | "PROPOSAL_NOT_FOUND"
  | "APPROVAL_ACTION_MISMATCH"
  | "APPROVAL_MISSION_MISMATCH"
  | "APPROVAL_PROPOSAL_MISMATCH";

export class MissionPlanServiceError extends Error {
  readonly kind: MissionPlanServiceErrorKind;

  constructor(kind: MissionPlanServiceErrorKind, message: string) {
    super(message);
    this.name = "MissionPlanServiceError";
    this.kind = kind;
  }
}

function loadTasks(taskStore: TaskStore, taskIds: readonly string[]): readonly Task[] {
  return taskIds
    .map((taskId) => taskStore.get(taskId))
    .filter((task): task is Task => task !== undefined);
}

function appendPlanProposedEvent(events: EventStore, proposal: MissionPlanProposal): DomainEvent {
  const event: DomainEvent = {
    id: `MISSION_PLAN_PROPOSED:${proposal.id}`,
    kind: "MISSION_PLAN_PROPOSED",
    actorId: proposal.createdBy,
    missionId: proposal.missionId,
    occurredAt: proposal.createdAt,
    data: {
      proposalId: proposal.id,
      taskIds: [...proposal.taskIds],
      rationale: proposal.rationale,
    },
  };

  events.append(event);
  return event;
}

function appendPolicyDecisionEvent(
  events: EventStore,
  decision: PolicyDecision,
  mission: Mission,
  actorId: ActorId,
  causedByEventId: EventId,
): DomainEvent {
  const event: DomainEvent = {
    id: `POLICY_DECIDED:${decision.id}`,
    kind: "POLICY_DECIDED",
    actorId,
    missionId: mission.id,
    occurredAt: decision.evaluatedAt,
    causedByEventId,
    data: {
      policyDecisionId: decision.id,
      policyId: decision.policyId,
      action: decision.action,
      riskLevel: decision.riskLevel,
      effect: decision.effect,
      reason: decision.reason,
    },
  };

  events.append(event);
  return event;
}

function appendApprovalRequestedEvent(
  events: EventStore,
  approval: ApprovalRequest,
  causedByEventId: EventId,
): DomainEvent {
  const event: DomainEvent = {
    id: `APPROVAL_REQUESTED:${approval.id}`,
    kind: "APPROVAL_REQUESTED",
    actorId: approval.requestedBy,
    missionId: approval.missionId,
    occurredAt: approval.requestedAt,
    causedByEventId,
    data: {
      approvalRequestId: approval.id,
      action: approval.action,
      riskLevel: approval.riskLevel,
      status: approval.status,
      proposalId: approval.proposalId,
    },
  };

  events.append(event);
  return event;
}

function appendApprovalResolvedEvent(
  events: EventStore,
  approval: ApprovalRequest,
  from: ApprovalRequest["status"],
  occurredAt: string,
): DomainEvent {
  const event: DomainEvent = {
    id: `APPROVAL_RESOLVED:${approval.id}:${occurredAt}`,
    kind: "APPROVAL_RESOLVED",
    ...(approval.resolvedBy !== undefined ? { actorId: approval.resolvedBy } : {}),
    missionId: approval.missionId,
    occurredAt,
    data: {
      approvalRequestId: approval.id,
      from,
      to: approval.status,
      proposalId: approval.proposalId,
    },
  };

  events.append(event);
  return event;
}

function appendPlanAppliedEvent(
  events: EventStore,
  proposal: MissionPlanProposal,
  mission: Mission,
  actorId: ActorId,
  causedByEventId: EventId,
): DomainEvent {
  const event: DomainEvent = {
    id: `MISSION_PLAN_APPLIED:${proposal.id}:${mission.updatedAt}`,
    kind: "MISSION_PLAN_APPLIED",
    actorId,
    missionId: mission.id,
    occurredAt: mission.updatedAt,
    causedByEventId,
    data: {
      proposalId: proposal.id,
      taskIds: [...proposal.taskIds],
    },
  };

  events.append(event);
  return event;
}

export class MissionPlanService {
  constructor(private readonly dependencies: MissionPlanServiceDependencies) {}

  private runInTransaction<T>(work: (stores: MissionPlanStores) => T): T {
    if (this.dependencies.unitOfWork === undefined) {
      return work(this.dependencies);
    }

    return this.dependencies.unitOfWork.transaction((context) =>
      work({
        missions: context.missions,
        tasks: context.tasks,
        proposals: context.missionPlanProposals,
        policyDecisions: context.policyDecisions,
        approvals: context.approvals,
        events: context.events,
      }),
    );
  }

  submit(input: SubmitMissionPlanInput): MissionPlanSubmissionResult {
    return this.runInTransaction((stores) => this.submitWithStores(stores, input));
  }

  private submitWithStores(
    stores: MissionPlanStores,
    input: SubmitMissionPlanInput,
  ): MissionPlanSubmissionResult {
    const mission = stores.missions.get(input.missionId);

    if (mission === undefined) {
      throw new MissionPlanServiceError(
        "MISSION_NOT_FOUND",
        `Mission not found: ${input.missionId}.`,
      );
    }

    if (mission.status !== "PLANNING") {
      throw new MissionPlanServiceError(
        "MISSION_NOT_PLANNING",
        `Cannot apply a plan while mission ${mission.id} is ${mission.status}.`,
      );
    }

    if (stores.proposals.get(input.proposalId) !== undefined) {
      throw new MissionPlanServiceError(
        "PROPOSAL_EXISTS",
        `Mission plan proposal already exists: ${input.proposalId}.`,
      );
    }

    if (stores.policyDecisions.get(input.decisionId) !== undefined) {
      throw new MissionPlanServiceError(
        "POLICY_DECISION_EXISTS",
        `Policy decision already exists: ${input.decisionId}.`,
      );
    }

    if (stores.approvals.get(input.approvalRequestId) !== undefined) {
      throw new MissionPlanServiceError(
        "APPROVAL_EXISTS",
        `Approval request already exists: ${input.approvalRequestId}.`,
      );
    }

    const proposal = createMissionPlanProposal({
      id: input.proposalId,
      missionId: mission.id,
      taskIds: input.taskIds,
      rationale: input.rationale,
      createdBy: input.createdBy,
      createdAt: input.createdAt,
    });

    const tasks = loadTasks(stores.tasks, proposal.taskIds);
    let authorization;

    try {
      authorization = authorizeMissionPlanApplication({
        proposal,
        mission,
        tasks,
        policy: input.policy,
        decisionId: input.decisionId,
        approvalRequestId: input.approvalRequestId,
        requestedBy: input.requestedBy,
        requestedAt: input.requestedAt,
        evaluatedAt: input.evaluatedAt,
        riskLevel: input.riskLevel,
        expiresAt: input.expiresAt,
      });
    } catch (error) {
      if (!(error instanceof MissionPlanApplicationDeniedError)) {
        throw error;
      }

      stores.proposals.save(proposal);
      stores.policyDecisions.save(error.decision);

      const proposedEvent = appendPlanProposedEvent(stores.events, proposal);
      const policyEvent = appendPolicyDecisionEvent(
        stores.events,
        error.decision,
        mission,
        input.requestedBy,
        proposedEvent.id,
      );

      return {
        status: "DENIED",
        mission,
        proposal,
        policyDecision: error.decision,
        events: [proposedEvent, policyEvent],
      };
    }

    stores.proposals.save(proposal);
    stores.policyDecisions.save(authorization.policyDecision);

    const proposedEvent = appendPlanProposedEvent(stores.events, proposal);
    const policyEvent = appendPolicyDecisionEvent(
      stores.events,
      authorization.policyDecision,
      mission,
      input.requestedBy,
      proposedEvent.id,
    );

    if (authorization.approvalRequest !== undefined) {
      stores.approvals.save(authorization.approvalRequest);
      const approvalEvent = appendApprovalRequestedEvent(
        stores.events,
        authorization.approvalRequest,
        policyEvent.id,
      );

      return {
        status: "APPROVAL_REQUIRED",
        mission,
        proposal,
        policyDecision: authorization.policyDecision,
        approvalRequest: authorization.approvalRequest,
        events: [proposedEvent, policyEvent, approvalEvent],
      };
    }

    const appliedMission = applyMissionPlanProposal(
      proposal,
      mission,
      tasks,
      input.appliedAt ?? input.evaluatedAt,
    );
    stores.missions.save(appliedMission);

    const appliedEvent = appendPlanAppliedEvent(
      stores.events,
      proposal,
      appliedMission,
      input.requestedBy,
      policyEvent.id,
    );

    return {
      status: "APPLIED",
      mission: appliedMission,
      proposal,
      policyDecision: authorization.policyDecision,
      events: [proposedEvent, policyEvent, appliedEvent],
    };
  }

  resolveApproval(input: ResolveMissionPlanApprovalInput): MissionPlanApprovalResolution {
    return this.runInTransaction((stores) => this.resolveApprovalWithStores(stores, input));
  }

  private resolveApprovalWithStores(
    stores: MissionPlanStores,
    input: ResolveMissionPlanApprovalInput,
  ): MissionPlanApprovalResolution {
    const approval = stores.approvals.get(input.approvalId);

    if (approval === undefined) {
      throw new MissionPlanServiceError(
        "APPROVAL_NOT_FOUND",
        `Approval request not found: ${input.approvalId}.`,
      );
    }

    if (approval.action !== "PLAN_APPLY") {
      throw new MissionPlanServiceError(
        "APPROVAL_ACTION_MISMATCH",
        `Approval does not authorize mission plan application: ${approval.action}.`,
      );
    }

    const missionId = approval.missionId;
    const proposalId = approval.proposalId;

    const mission = missionId === undefined ? undefined : stores.missions.get(missionId);
    const proposal = proposalId === undefined ? undefined : stores.proposals.get(proposalId);

    if (mission === undefined) {
      throw new MissionPlanServiceError(
        "APPROVAL_MISSION_MISMATCH",
        "Approval is not bound to a persisted mission.",
      );
    }

    if (proposal === undefined) {
      throw new MissionPlanServiceError(
        "APPROVAL_PROPOSAL_MISMATCH",
        "Approval is not bound to a persisted mission plan proposal.",
      );
    }

    const tasks = loadTasks(stores.tasks, proposal.taskIds);

    if (input.status === "APPROVED" && mission.status !== "PLANNING") {
      throw new MissionPlanServiceError(
        "MISSION_NOT_PLANNING",
        `Cannot apply a plan while mission ${mission.id} is ${mission.status}.`,
      );
    }

    const resolvedApproval = transitionApprovalStatus(
      approval,
      input.status,
      input.resolvedAt,
      input.resolvedBy,
    );

    const events: DomainEvent[] = [];

    if (resolvedApproval.status === "APPROVED") {
      const appliedMission = applyApprovedMissionPlanProposal(
        resolvedApproval,
        proposal,
        mission,
        tasks,
        input.resolvedAt,
      );

      stores.approvals.save(resolvedApproval);
      stores.missions.save(appliedMission);

      const approvalEvent = appendApprovalResolvedEvent(
        stores.events,
        resolvedApproval,
        approval.status,
        input.resolvedAt,
      );
      events.push(approvalEvent);

      const appliedEvent = appendPlanAppliedEvent(
        stores.events,
        proposal,
        appliedMission,
        input.resolvedBy ?? approval.requestedBy,
        approvalEvent.id,
      );
      events.push(appliedEvent);

      return {
        status: "APPLIED",
        approval: resolvedApproval,
        mission: appliedMission,
        proposal,
        events,
      };
    }

    stores.approvals.save(resolvedApproval);
    const approvalEvent = appendApprovalResolvedEvent(
      stores.events,
      resolvedApproval,
      approval.status,
      input.resolvedAt,
    );
    events.push(approvalEvent);

    const status =
      input.status === "REJECTED"
        ? "REJECTED"
        : input.status === "EXPIRED"
          ? "EXPIRED"
          : "CANCELLED";

    return {
      status,
      approval: resolvedApproval,
      mission,
      proposal,
      events,
    };
  }
}
