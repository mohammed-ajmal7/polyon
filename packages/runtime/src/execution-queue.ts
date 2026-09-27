import type { Execution, ExecutionId, ExecutionStatus } from "@polyon/contracts";

export type ExecutionQueueErrorKind = "EXECUTION_NOT_QUEUED" | "EXECUTION_ALREADY_QUEUED";

export class ExecutionQueueError extends Error {
  readonly kind: ExecutionQueueErrorKind;
  readonly executionId: ExecutionId;
  readonly status: ExecutionStatus;

  constructor(kind: ExecutionQueueErrorKind, executionId: ExecutionId, status: ExecutionStatus) {
    super(`Cannot enqueue execution ${executionId} with status: ${status}.`);
    this.name = "ExecutionQueueError";
    this.kind = kind;
    this.executionId = executionId;
    this.status = status;
  }
}

export interface ExecutionQueue {
  enqueue(execution: Execution): void;
  has(executionId: ExecutionId): boolean;
  peek(): Execution | undefined;
  dequeue(): Execution | undefined;
  size(): number;
}

function cloneExecution(execution: Execution): Execution {
  return { ...execution };
}

export class InMemoryExecutionQueue implements ExecutionQueue {
  private readonly queue: Execution[] = [];

  enqueue(execution: Execution): void {
    if (execution.status !== "QUEUED") {
      throw new ExecutionQueueError("EXECUTION_NOT_QUEUED", execution.id, execution.status);
    }

    if (this.has(execution.id)) {
      throw new ExecutionQueueError("EXECUTION_ALREADY_QUEUED", execution.id, execution.status);
    }

    this.queue.push(cloneExecution(execution));
  }

  has(executionId: ExecutionId): boolean {
    return this.queue.some((execution) => execution.id === executionId);
  }

  peek(): Execution | undefined {
    const execution = this.queue[0];

    return execution === undefined ? undefined : cloneExecution(execution);
  }

  dequeue(): Execution | undefined {
    const execution = this.queue.shift();

    return execution === undefined ? undefined : cloneExecution(execution);
  }

  size(): number {
    return this.queue.length;
  }
}
