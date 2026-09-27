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

export function recoverExecutions(
  executions: ExecutionStore,
  queue: ExecutionQueue,
  approvals: ApprovalRequestStore | undefined,
  recoveredAt: string,
): readonly ExecutionId[] {
  const recovered: ExecutionId[] = [];

  for (const execution of executions.list()) {
    if (queue.has(execution.id)) {
      continue;
    }

    if (execution.status === "QUEUED") {
      queue.enqueue(execution);
      recovered.push(execution.id);
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
      recovered.push(recoveredExecution.id);
    }
  }

  return recovered;
}
