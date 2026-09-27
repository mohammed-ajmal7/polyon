import type {
  ActorId,
  ApprovalRequest,
  DomainEvent,
  Execution,
  ExecutionStatus,
  Task,
  TaskStatus,
} from "@polyon/contracts";

import {
  applyApprovedExecutionRun,
  cancelExecution,
  rejectExecution,
  transitionApprovalStatus,
  transitionExecutionStatus,
  transitionTaskStatus,
} from "@polyon/core";

import type { ExecutionQueue } from "@polyon/runtime";
import type {
  ApprovalRequestStore,
  DomainStoreTransactionContext,
  DomainUnitOfWork,
  EventStore,
  ExecutionStore,
  TaskStore,
} from "@polyon/storage";

export interface ResolveExecutionApprovalInput {
  readonly status: "APPROVED" | "REJECTED" | "EXPIRED" | "CANCELLED";
  readonly resolvedAt: string;
  readonly resolvedBy?: ActorId;
  readonly rejectionReason?: string;
}

export type ExecutionApprovalServiceErrorKind =
  | "EXECUTION_NOT_AWAITING_APPROVAL"
  | "TASK_NOT_PERSISTED"
  | "TASK_MISSION_MISMATCH"
  | "TASK_NOT_AWAITING_APPROVAL";

export class ExecutionApprovalServiceError extends Error {
  readonly kind: ExecutionApprovalServiceErrorKind;

  constructor(kind: ExecutionApprovalServiceErrorKind, message: string) {
    super(message);
    this.name = "ExecutionApprovalServiceError";
    this.kind = kind;
  }
}

export interface ExecutionApprovalResolution {
  readonly approval: ApprovalRequest;
  readonly execution: Execution;
  readonly nextStep: "ENQUEUE" | "REJECTED" | "CANCELLED";
}

export interface ExecutionApprovalServiceDependencies {
  readonly approvals: ApprovalRequestStore;
  readonly executions: ExecutionStore;
  readonly tasks: TaskStore;
  readonly queue: ExecutionQueue;
  readonly events: EventStore;
  readonly unitOfWork?: DomainUnitOfWork;
}

type ExecutionApprovalStores = Pick<
  DomainStoreTransactionContext,
  "approvals" | "executions" | "tasks" | "events"
>;

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

function appendTaskStatusChangedEvent(
  events: EventStore,
  task: Task,
  from: TaskStatus,
  to: TaskStatus,
  occurredAt: string,
): void {
  const event: DomainEvent = {
    id: `TASK_STATUS_CHANGED:${task.id}:${from}:${to}:${occurredAt}`,
    kind: "TASK_STATUS_CHANGED",
    actorId: undefined,
    missionId: task.missionId,
    taskId: task.id,
    occurredAt,
    data: {
      from,
      to,
    },
  };

  events.append(event);
}

function validateExecutionApprovalBinding(approval: ApprovalRequest, execution: Execution): void {
  if (approval.action !== "EXECUTION_RUN") {
    throw new Error("Approval does not authorize an execution run.");
  }

  if (approval.missionId !== execution.missionId) {
    throw new Error("Approval is not bound to the supplied execution mission.");
  }

  if (approval.taskId !== execution.taskId) {
    throw new Error("Approval is not bound to the supplied execution task.");
  }

  if (approval.executionId !== execution.id) {
    throw new Error("Approval is not bound to the supplied execution.");
  }
}

export class ExecutionApprovalService {
  constructor(private readonly dependencies: ExecutionApprovalServiceDependencies) {}

  resolve(
    approval: ApprovalRequest,
    execution: Execution,
    input: ResolveExecutionApprovalInput,
  ): ExecutionApprovalResolution {
    const operation = (stores: ExecutionApprovalStores) =>
      this.resolveWithStores(stores, approval, execution, input);

    const result =
      this.dependencies.unitOfWork === undefined
        ? operation(this.dependencies)
        : this.dependencies.unitOfWork.transaction(operation);

    if (result.nextStep === "ENQUEUE") {
      this.dependencies.queue.enqueue(result.execution);
    }

    return result;
  }

  private resolveWithStores(
    stores: ExecutionApprovalStores,
    approval: ApprovalRequest,
    execution: Execution,
    input: ResolveExecutionApprovalInput,
  ): ExecutionApprovalResolution {
    if (execution.status !== "APPROVAL_REQUIRED") {
      throw new ExecutionApprovalServiceError(
        "EXECUTION_NOT_AWAITING_APPROVAL",
        `Cannot resolve execution approval while execution status is ${execution.status}.`,
      );
    }

    validateExecutionApprovalBinding(approval, execution);

    const task = stores.tasks.get(execution.taskId);

    if (task === undefined) {
      throw new ExecutionApprovalServiceError(
        "TASK_NOT_PERSISTED",
        `Cannot resolve approval for execution ${execution.id} because task is not persisted: ${execution.taskId}.`,
      );
    }

    if (task.missionId !== execution.missionId) {
      throw new ExecutionApprovalServiceError(
        "TASK_MISSION_MISMATCH",
        "Persisted task mission does not match the execution mission.",
      );
    }

    if (task.status !== "APPROVAL_REQUIRED") {
      throw new ExecutionApprovalServiceError(
        "TASK_NOT_AWAITING_APPROVAL",
        `Cannot resolve approval while task status is ${task.status}.`,
      );
    }

    const resolvedApproval = transitionApprovalStatus(
      approval,
      input.status,
      input.resolvedAt,
      input.resolvedBy,
    );

    if (input.status === "APPROVED") {
      const approvedExecution = applyApprovedExecutionRun(
        resolvedApproval,
        execution,
        input.resolvedAt,
      );
      const queuedExecution = transitionExecutionStatus(
        approvedExecution,
        "QUEUED",
        input.resolvedAt,
      );
      const approvedTask = transitionTaskStatus(task, "APPROVED", input.resolvedAt);

      stores.approvals.save(resolvedApproval);
      stores.executions.save(queuedExecution);
      stores.tasks.save(approvedTask);
      stores.events.append({
        id: `APPROVAL_RESOLVED:${resolvedApproval.id}:${input.resolvedAt}`,
        kind: "APPROVAL_RESOLVED",
        ...(resolvedApproval.resolvedBy !== undefined
          ? { actorId: resolvedApproval.resolvedBy }
          : {}),
        missionId: execution.missionId,
        taskId: execution.taskId,
        executionId: execution.id,
        occurredAt: input.resolvedAt,
        data: {
          approvalRequestId: resolvedApproval.id,
          from: approval.status,
          to: resolvedApproval.status,
        },
      });
      appendExecutionStatusChangedEvent(
        stores.events,
        execution,
        "APPROVAL_REQUIRED",
        "APPROVED",
        input.resolvedAt,
      );
      appendTaskStatusChangedEvent(
        stores.events,
        approvedTask,
        "APPROVAL_REQUIRED",
        "APPROVED",
        input.resolvedAt,
      );
      appendExecutionStatusChangedEvent(
        stores.events,
        queuedExecution,
        "APPROVED",
        "QUEUED",
        input.resolvedAt,
      );
      return {
        approval: resolvedApproval,
        execution: queuedExecution,
        nextStep: "ENQUEUE",
      };
    }

    const reason =
      input.rejectionReason ?? "Execution approval was " + input.status.toLowerCase() + ".";

    const targetTaskStatus = input.status === "CANCELLED" ? "CANCELLED" : "REJECTED";
    const updatedExecution =
      input.status === "CANCELLED"
        ? cancelExecution(execution, input.resolvedAt)
        : rejectExecution(execution, input.resolvedAt, reason);
    const updatedTask = transitionTaskStatus(task, targetTaskStatus, input.resolvedAt);

    stores.approvals.save(resolvedApproval);
    stores.executions.save(updatedExecution);
    stores.tasks.save(updatedTask);
    stores.events.append({
      id: `APPROVAL_RESOLVED:${resolvedApproval.id}:${input.resolvedAt}`,
      kind: "APPROVAL_RESOLVED",
      ...(resolvedApproval.resolvedBy !== undefined
        ? { actorId: resolvedApproval.resolvedBy }
        : {}),
      missionId: execution.missionId,
      taskId: execution.taskId,
      executionId: execution.id,
      occurredAt: input.resolvedAt,
      data: {
        approvalRequestId: resolvedApproval.id,
        from: approval.status,
        to: resolvedApproval.status,
      },
    });
    appendExecutionStatusChangedEvent(
      stores.events,
      execution,
      "APPROVAL_REQUIRED",
      updatedExecution.status,
      input.resolvedAt,
    );
    appendTaskStatusChangedEvent(
      stores.events,
      updatedTask,
      "APPROVAL_REQUIRED",
      updatedTask.status,
      input.resolvedAt,
    );

    return {
      approval: resolvedApproval,
      execution: updatedExecution,
      nextStep: input.status === "CANCELLED" ? "CANCELLED" : "REJECTED",
    };
  }
}
