import type { ExecutionId } from "@polyon/contracts";

import { recoverRunningExecution } from "@polyon/core";
import type { ApprovalRequestStore, ExecutionStore } from "@polyon/storage";

import type { ExecutionQueue } from "./execution-queue";

function hasResumableToolContinuation(
  approvals: ApprovalRequestStore,
  executionId: ExecutionId,
): boolean {
  return approvals.list().some(
    (approval) =>
      approval.executionId === executionId &&
      approval.status === "APPROVED" &&
      approval.toolContinuation !== undefined &&
      approval.toolContinuation.state !== "COMPLETED",
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
  | "INTERRUPTED_TOOL_CONTINUATION";

export interface ExecutionRecovery {
  readonly executionId: ExecutionId;
  readonly kind: ExecutionRecoveryKind;
}

export function recoverExecutions(
  executions: ExecutionStore,
  queue: ExecutionQueue,
  approvals: ApprovalRequestStore | undefined,
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

    if (
      execution.status === "RUNNING" &&
      approvals !== undefined &&
      hasResumableToolContinuation(approvals, execution.id)
    ) {
      const recoveredExecution = recoverRunningExecution(execution, recoveredAt);
      executions.save(recoveredExecution);
      queue.enqueue(recoveredExecution);
      recovered.push({
        executionId: recoveredExecution.id,
        kind: "INTERRUPTED_TOOL_CONTINUATION",
      });
    }
  }

  return recovered;
}
