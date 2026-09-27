import type { Execution } from "@polyon/contracts";

import {
  completeExecution,
  startExecution,
} from "@polyon/core";

import type { ExecutionQueue } from "./execution-queue";
import type { ExecutionRunner } from "./execution-runner";

export interface ExecutionCoordinator {
  runNext(now: string, completionAt: string): Promise<Execution | undefined>;
}

export class InMemoryExecutionCoordinator implements ExecutionCoordinator {
  constructor(
    private readonly queue: ExecutionQueue,
    private readonly runner: ExecutionRunner,
  ) {}

  async runNext(now: string, completionAt: string): Promise<Execution | undefined> {
    const queued = this.queue.dequeue();

    if (queued === undefined) {
      return undefined;
    }

    const running = startExecution(queued, now);

    try {
      const result = await this.runner.run(running);

      return completeExecution(running, {
        status: result.status,
        completedAt: completionAt,
        error: result.error,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Execution runner failed.";

      return completeExecution(running, {
        status: "FAILED",
        completedAt: completionAt,
        error: message,
      });
    }
  }
}
