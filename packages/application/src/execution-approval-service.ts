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

export class ExecutionApprovalService {
  constructor(
    private readonly dependencies: ExecutionApprovalServiceDependencies,
  ) {}

  resolve(
    approval: ApprovalRequest,
    execution: Execution,
    input: ResolveExecutionApprovalInput,
  ): ExecutionApprovalResolution {
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
