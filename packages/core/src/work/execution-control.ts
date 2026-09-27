import type { Execution } from "@polyon/contracts";

import { transitionExecutionStatus } from "./execution-transition";

export type ExecutionCompletionStatus = "SUCCEEDED" | "FAILED" | "CANCELLED";

export interface CompleteExecutionInput {
  readonly status: ExecutionCompletionStatus;
  readonly completedAt: string;
  readonly error?: string;
}

export type ExecutionControlErrorKind =
  | "FAILED_EXECUTION_REQUIRES_ERROR"
  | "EXECUTION_NOT_RUNNING";

export class ExecutionControlError extends Error {
  readonly kind: ExecutionControlErrorKind;

  constructor(kind: ExecutionControlErrorKind, message: string) {
    super(message);
    this.name = "ExecutionControlError";
    this.kind = kind;
  }
}

export function startExecution(execution: Execution, startedAt: string): Execution {
  const updated = transitionExecutionStatus(execution, "RUNNING", startedAt);

  return {
    ...updated,
    startedAt: execution.startedAt ?? startedAt,
  };
}

export function cancelExecution(execution: Execution, cancelledAt: string): Execution {
  return transitionExecutionStatus(execution, "CANCELLED", cancelledAt);
}

export function rejectExecution(
  execution: Execution,
  rejectedAt: string,
  reason: string,
): Execution {
  return {
    ...transitionExecutionStatus(execution, "REJECTED", rejectedAt),
    error: reason,
  };
}

export function pauseExecution(execution: Execution, pausedAt: string): Execution {
  return transitionExecutionStatus(execution, "PAUSED", pausedAt);
}

export function resumeExecution(execution: Execution, resumedAt: string): Execution {
  return transitionExecutionStatus(execution, "QUEUED", resumedAt);
}

export function recoverRunningExecution(
  execution: Execution,
  recoveredAt: string,
): Execution {
  if (execution.status !== "RUNNING") {
    throw new ExecutionControlError(
      "EXECUTION_NOT_RUNNING",
      `Only a running execution can be recovered: ${execution.id}.`,
    );
  }

  return {
    ...execution,
    status: "QUEUED",
    updatedAt: recoveredAt,
  };
}

export function completeExecution(execution: Execution, input: CompleteExecutionInput): Execution {
  if (input.status === "FAILED" && (input.error === undefined || input.error.trim() === "")) {
    throw new ExecutionControlError(
      "FAILED_EXECUTION_REQUIRES_ERROR",
      "Failed executions require a non-empty error message.",
    );
  }

  const updated = transitionExecutionStatus(execution, input.status, input.completedAt);

  return {
    ...updated,
    completedAt: input.completedAt,
    ...(input.status === "FAILED" && input.error !== undefined ? { error: input.error } : {}),
  };
}
