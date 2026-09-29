import type { ApprovalRequest, ExecutionId } from "@polyon/contracts";

import {
  completeExecution,
  pauseExecution,
  recoverRunningExecution,
  transitionTaskStatus,
} from "@polyon/core";
import type { ApprovalRequestStore, ExecutionStore, TaskStore } from "@polyon/storage";

import type { ExecutionQueue } from "./execution-queue";

function findIntegrationContinuation(
  approvals: ApprovalRequestStore,
  executionId: ExecutionId,
  status: "PENDING" | "APPROVED",
): NonNullable<import("@polyon/contracts").ApprovalRequest["integrationContinuation"]> | undefined {
  return approvals
    .list()
    .filter(
      (approval) =>
        approval.executionId === executionId &&
        approval.status === status &&
        approval.integrationContinuation !== undefined,
    )
    .sort((left, right) =>
      (right.resolvedAt ?? right.requestedAt).localeCompare(left.resolvedAt ?? left.requestedAt),
    )
    .map((approval) => approval.integrationContinuation!)
    .at(0);
}

function findToolContinuation(
  approvals: ApprovalRequestStore,
  executionId: ExecutionId,
  status: "PENDING" | "APPROVED",
): NonNullable<import("@polyon/contracts").ApprovalRequest["toolContinuation"]> | undefined {
  return approvals
    .list()
    .filter(
      (approval) =>
        approval.executionId === executionId &&
        approval.status === status &&
        approval.toolContinuation !== undefined,
    )
    .sort((left, right) =>
      (right.resolvedAt ?? right.requestedAt).localeCompare(left.resolvedAt ?? left.requestedAt),
    )
    .map((approval) => approval.toolContinuation!)
    .at(0);
}

function hasResumableToolContinuation(
  approvals: ApprovalRequestStore,
  executionId: ExecutionId,
): boolean {
  return findToolContinuation(approvals, executionId, "APPROVED") !== undefined;
}

function hasPendingToolContinuation(
  approvals: ApprovalRequestStore,
  executionId: ExecutionId,
): boolean {
  return findToolContinuation(approvals, executionId, "PENDING") !== undefined;
}

function hasPendingIntegrationContinuation(
  approvals: ApprovalRequestStore,
  executionId: ExecutionId,
): boolean {
  return findIntegrationContinuation(approvals, executionId, "PENDING") !== undefined;
}

function hasApprovalContinuation(
  approvals: ApprovalRequestStore,
  executionId: ExecutionId,
): boolean {
  return approvals
    .list()
    .some(
      (approval) =>
        approval.executionId === executionId &&
        (approval.toolContinuation !== undefined || approval.integrationContinuation !== undefined),
    );
}

export function recoverQueuedExecutions(
  executions: ExecutionStore,
  queue: ExecutionQueue,
): readonly ExecutionId[] {
  const recovered: ExecutionId[] = [];

  for (const execution of executions.list()) {
    if (execution.status !== "QUEUED" || queue.has(execution.id)) {
      continue;
    }

    queue.enqueue(execution);
    recovered.push(execution.id);
  }

  return recovered;
}

export type ExecutionRecoveryKind =
  | "QUEUED_EXECUTION"
  | "INTERRUPTED_TOOL_CONTINUATION"
  | "PENDING_TOOL_APPROVAL_RESTART"
  | "INTERRUPTED_INTEGRATION_CONTINUATION"
  | "PENDING_INTEGRATION_APPROVAL_RESTART"
  | "NON_IDEMPOTENT_INTEGRATION_RECONCILIATION"
  | "INTERRUPTED_EXECUTION_FAILED";

export interface ExecutionRecovery {
  readonly executionId: ExecutionId;
  readonly kind: ExecutionRecoveryKind;
}

export function recoverExecutions(
  executions: ExecutionStore,
  queue: ExecutionQueue,
  approvals: ApprovalRequestStore | undefined,
  tasks: TaskStore | undefined,
  recoveredAt: string,
): readonly ExecutionRecovery[] {
  const recovered: ExecutionRecovery[] = [];

  for (const execution of executions.list()) {
    if (queue.has(execution.id)) {
      continue;
    }

    if (execution.status === "QUEUED") {
      queue.enqueue(execution);
      recovered.push({
        executionId: execution.id,
        kind: "QUEUED_EXECUTION",
      });
      continue;
    }

    // A plain run interrupted by a restart cannot be resumed, so fail it instead of
    // leaving the execution and its task RUNNING forever.
    if (
      execution.status === "RUNNING" &&
      (approvals === undefined || !hasApprovalContinuation(approvals, execution.id))
    ) {
      const failedExecution = completeExecution(execution, {
        status: "FAILED",
        completedAt: recoveredAt,
        error: "Execution was interrupted by a restart before it finished.",
      });
      executions.save(failedExecution);

      const task = tasks?.get(execution.taskId);
      if (tasks !== undefined && task !== undefined && task.status === "RUNNING") {
        tasks.save(transitionTaskStatus(task, "FAILED", recoveredAt));
      }

      recovered.push({
        executionId: failedExecution.id,
        kind: "INTERRUPTED_EXECUTION_FAILED",
      });
      continue;
    }

    if (execution.status === "RUNNING" && approvals !== undefined) {
      if (hasPendingToolContinuation(approvals, execution.id)) {
        if (tasks === undefined) {
          continue;
        }
        const task = tasks.get(execution.taskId);
        if (task === undefined || task.status !== "RUNNING") {
          continue;
        }

        const pausedExecution = pauseExecution(execution, recoveredAt);
        const pausedTask = transitionTaskStatus(task, "PAUSED", recoveredAt);
        executions.save(pausedExecution);
        tasks.save(pausedTask);
        recovered.push({
          executionId: pausedExecution.id,
          kind: "PENDING_TOOL_APPROVAL_RESTART",
        });
        continue;
      }

      if (hasPendingIntegrationContinuation(approvals, execution.id)) {
        if (tasks === undefined) {
          continue;
        }
        const task = tasks.get(execution.taskId);
        if (task === undefined || task.status !== "RUNNING") {
          continue;
        }

        const pausedExecution = pauseExecution(execution, recoveredAt);
        const pausedTask = transitionTaskStatus(task, "PAUSED", recoveredAt);
        executions.save(pausedExecution);
        tasks.save(pausedTask);
        recovered.push({
          executionId: pausedExecution.id,
          kind: "PENDING_INTEGRATION_APPROVAL_RESTART",
        });
        continue;
      }

      const integrationContinuation = findIntegrationContinuation(
        approvals,
        execution.id,
        "APPROVED",
      );

      if (
        integrationContinuation !== undefined &&
        integrationContinuation.state === "AWAITING_INTEGRATION" &&
        integrationContinuation.sideEffectClass === "NON_IDEMPOTENT"
      ) {
        if (tasks === undefined) {
          continue;
        }

        const task = tasks.get(execution.taskId);

        if (task === undefined || task.status !== "RUNNING") {
          continue;
        }

        const pausedExecution = pauseExecution(execution, recoveredAt);
        const pausedTask = transitionTaskStatus(task, "PAUSED", recoveredAt);
        executions.save(pausedExecution);
        tasks.save(pausedTask);
        recovered.push({
          executionId: pausedExecution.id,
          kind: "NON_IDEMPOTENT_INTEGRATION_RECONCILIATION",
        });
        continue;
      }

      if (
        integrationContinuation !== undefined &&
        integrationContinuation.state !== "RECONCILIATION_REQUIRED"
      ) {
        const recoveredExecution = recoverRunningExecution(execution, recoveredAt);
        executions.save(recoveredExecution);
        queue.enqueue(recoveredExecution);
        recovered.push({
          executionId: recoveredExecution.id,
          kind: "INTERRUPTED_INTEGRATION_CONTINUATION",
        });
        continue;
      }

      if (hasResumableToolContinuation(approvals, execution.id)) {
        const recoveredExecution = recoverRunningExecution(execution, recoveredAt);
        executions.save(recoveredExecution);
        queue.enqueue(recoveredExecution);
        recovered.push({
          executionId: recoveredExecution.id,
          kind: "INTERRUPTED_TOOL_CONTINUATION",
        });
      }
    }
  }

  return recovered;
}
