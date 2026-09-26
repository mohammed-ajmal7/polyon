import type { ActorId, Execution, ExecutionId } from "@polyon/contracts";

export interface RetryExecutionInput {
  readonly id: ExecutionId;
  readonly actorId: ActorId;
  readonly createdAt: string;
}

export class ExecutionRetryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExecutionRetryError";
  }
}

export function createRetryExecution(
  execution: Execution,
  input: RetryExecutionInput,
): Execution {
  if (execution.status !== "FAILED") {
    throw new ExecutionRetryError(
      `Cannot retry execution with status: ${execution.status}.`,
    );
  }

  return {
    id: input.id,
    missionId: execution.missionId,
    taskId: execution.taskId,
    actorId: input.actorId,
    attempt: execution.attempt + 1,
    status: "PENDING",
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
  };
}
