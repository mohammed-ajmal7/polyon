import type { ExecutionId } from "@polyon/contracts";

import type { ExecutionStore } from "@polyon/storage";

import type { ExecutionQueue } from "./execution-queue";

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
