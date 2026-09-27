import type {
  ApprovalRequest,
  DomainEvent,
  Execution,
  ExecutionStatus,
  PolicyDecision,
} from "@polyon/contracts";

import { applyApprovedExecutionRun } from "@polyon/core";

import {
  prepareExecutionDispatch,
  type ExecutionDispatchPlan,
  type PrepareExecutionDispatchInput,
} from "./execution-dispatch";

import type { ExecutionQueue } from "@polyon/runtime";
import type {
  ApprovalRequestStore,
  DomainStoreTransactionContext,
  DomainUnitOfWork,
  EventStore,
  ExecutionStore,
  PolicyDecisionStore,
} from "@polyon/storage";

export interface ExecutionDispatchServiceDependencies {
  readonly queue: ExecutionQueue;
  readonly executions: ExecutionStore;
  readonly approvals: ApprovalRequestStore;
  readonly policyDecisions: PolicyDecisionStore;
  readonly events: EventStore;
  readonly unitOfWork?: DomainUnitOfWork;
}

type ExecutionDispatchStores = Pick<
  DomainStoreTransactionContext,
  "executions" | "approvals" | "policyDecisions" | "events"
>;

export interface PersistedExecutionDispatch {
  readonly execution: ExecutionDispatchPlan["execution"];
  readonly policyDecision: PolicyDecision;
  readonly approvalRequest?: ApprovalRequest;
  readonly nextStep: ExecutionDispatchPlan["nextStep"];
}

function appendExecutionStatusChangedEvent(
  events: EventStore,
  execution: Execution,
  from: ExecutionStatus,
  to: ExecutionStatus,
  occurredAt: string,
): void {
  const event: DomainEvent = {
    id: `EXECUTION_STATUS_CHANGED:${execution.id}:${from}:${to}:${occurredAt}`,
    kind: "EXECUTION_STATUS_CHANGED",
    actorId: execution.actorId,
    missionId: execution.missionId,
    taskId: execution.taskId,
    executionId: execution.id,
    occurredAt,
    data: {
      from,
      to,
    },
  };

  events.append(event);
}

export class ExecutionDispatchService {
  constructor(private readonly dependencies: ExecutionDispatchServiceDependencies) {}

  dispatch(input: PrepareExecutionDispatchInput): PersistedExecutionDispatch {
    const operation = (stores: ExecutionDispatchStores) =>
      this.dispatchWithStores(stores, input);

    const result =
      this.dependencies.unitOfWork === undefined
        ? operation(this.dependencies)
        : this.dependencies.unitOfWork.transaction(operation);

    if (result.nextStep === "ENQUEUE") {
      this.dependencies.queue.enqueue(result.execution);
    }

    return result;
  }

  private dispatchWithStores(
    stores: ExecutionDispatchStores,
    input: PrepareExecutionDispatchInput,
  ): PersistedExecutionDispatch {
    if (stores.executions.get(input.executionId) !== undefined) {
      throw new Error(`Execution already exists: ${input.executionId}.`);
    }

    const plan = prepareExecutionDispatch(input);

    stores.executions.save(plan.execution);
    stores.policyDecisions.save(plan.policyDecision);

    stores.events.append({
      id: `EXECUTION_CREATED:${plan.execution.id}`,
      kind: "EXECUTION_CREATED",
      actorId: plan.execution.actorId,
      missionId: plan.execution.missionId,
      taskId: plan.execution.taskId,
      executionId: plan.execution.id,
      occurredAt: plan.execution.createdAt,
      data: {
        attempt: plan.execution.attempt,
        status: "PENDING",
      },
    });

    stores.events.append({
      id: `POLICY_DECIDED:${plan.policyDecision.id}`,
      kind: "POLICY_DECIDED",
      actorId: plan.execution.actorId,
      missionId: plan.execution.missionId,
      taskId: plan.execution.taskId,
      executionId: plan.execution.id,
      occurredAt: plan.policyDecision.evaluatedAt,
      data: {
        policyDecisionId: plan.policyDecision.id,
        policyId: plan.policyDecision.policyId,
        action: plan.policyDecision.action,
        riskLevel: plan.policyDecision.riskLevel,
        effect: plan.policyDecision.effect,
        reason: plan.policyDecision.reason,
      },
    });

    if (plan.approvalRequest !== undefined) {
      stores.approvals.save(plan.approvalRequest);
      stores.events.append({
        id: `APPROVAL_REQUESTED:${plan.approvalRequest.id}`,
        kind: "APPROVAL_REQUESTED",
        actorId: plan.approvalRequest.requestedBy,
        missionId: plan.execution.missionId,
        taskId: plan.execution.taskId,
        executionId: plan.execution.id,
        occurredAt: plan.approvalRequest.requestedAt,
        data: {
          approvalRequestId: plan.approvalRequest.id,
          action: plan.approvalRequest.action,
          riskLevel: plan.approvalRequest.riskLevel,
          status: plan.approvalRequest.status,
        },
      });
    }

    if (plan.execution.status !== "PENDING") {
      appendExecutionStatusChangedEvent(
        stores.events,
        plan.execution,
        "PENDING",
        plan.execution.status,
        plan.execution.updatedAt,
      );
    }

    if (plan.nextStep === "ENQUEUE") {
      stores.queue.enqueue(plan.execution);
    }

    return plan;
  
  }

  queueApproved(
    approval: ApprovalRequest,
    execution: PersistedExecutionDispatch["execution"],
    now: string,
  ): PersistedExecutionDispatch["execution"] {
    const operation = (stores: ExecutionDispatchStores) =>
      this.queueApprovedWithStores(stores, approval, execution, now);

    const queued =
      this.dependencies.unitOfWork === undefined
        ? operation(this.dependencies)
        : this.dependencies.unitOfWork.transaction(operation);

    this.dependencies.queue.enqueue(queued);
    return queued;
  }

  private queueApprovedWithStores(
    stores: ExecutionDispatchStores,
    approval: ApprovalRequest,
    execution: PersistedExecutionDispatch["execution"],
    now: string,
  ): PersistedExecutionDispatch["execution"] {
    const approved = applyApprovedExecutionRun(approval, execution, now);

    const queued = {
      ...approved,
      status: "QUEUED" as const,
      updatedAt: now,
    };

    stores.approvals.save(approval);
    stores.executions.save(queued);
    appendExecutionStatusChangedEvent(
      stores.events,
      execution,
      "APPROVAL_REQUIRED",
      "APPROVED",
      now,
    );
    appendExecutionStatusChangedEvent(
      stores.events,
      queued,
      "APPROVED",
      "QUEUED",
      now,
    );return queued;
  
  }
}
