import type {
  ActorId,
  ApprovalRequest,
  Execution,
} from "@polyon/contracts";

import {
  applyApprovedExecutionRun,
  cancelExecution,
  rejectExecution,
  transitionApprovalStatus,
  transitionExecutionStatus,
} from "@polyon/core";

import type { ExecutionQueue } from "@polyon/runtime";
import type { ApprovalRequestStore, ExecutionStore } from "@polyon/storage";

export interface ResolveExecutionApprovalInput {
  readonly status: "APPROVED" | "REJECTED" | "EXPIRED" | "CANCELLED";
  readonly resolvedAt: string;
  readonly resolvedBy?: ActorId;
  readonly rejectionReason?: string;
}

export type ExecutionApprovalServiceErrorKind = "EXECUTION_NOT_AWAITING_APPROVAL";

export class ExecutionApprovalServiceError extends Error {
  readonly kind: ExecutionApprovalServiceErrorKind;

  constructor(kind: ExecutionApprovalServiceErrorKind, message: string) {
    super(message);
    this.name = "ExecutionApprovalServiceError";
    this.kind = kind;
  }
}

export type ExecutionApprovalServiceErrorKind = "EXECUTION_NOT_AWAITING_APPROVAL";

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
  readonly queue: ExecutionQueue;
}

function validateExecutionApprovalBinding(
  approval: ApprovalRequest,
  execution: Execution,
): void {
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
  constructor(
    private readonly dependencies: ExecutionApprovalServiceDependencies,
  ) {}

  resolve(
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

      this.dependencies.approvals.save(resolvedApproval);
      this.dependencies.executions.save(queuedExecution);
      this.dependencies.queue.enqueue(queuedExecution);

      return {
        approval: resolvedApproval,
        execution: queuedExecution,
        nextStep: "ENQUEUE",
      };
    }

    const reason =
      input.rejectionReason ??
      "Execution approval was " + input.status.toLowerCase() + ".";

    const updatedExecution =
      input.status === "CANCELLED"
        ? cancelExecution(execution, input.resolvedAt)
        : rejectExecution(execution, input.resolvedAt, reason);

    this.dependencies.approvals.save(resolvedApproval);
    this.dependencies.executions.save(updatedExecution);

    return {
      approval: resolvedApproval,
      execution: updatedExecution,
      nextStep: input.status === "CANCELLED" ? "CANCELLED" : "REJECTED",
    };
  }
}
