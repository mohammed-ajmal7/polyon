import type { Execution } from "@polyon/contracts";

import {
  completeExecution,
  startExecution,
} from "@polyon/core";

import type { ExecutionStore } from "@polyon/storage";

import type { ExecutionQueue } from "./execution-queue";
import type { ExecutionRunner } from "./execution-runner";

export interface ExecutionCoordinator {
  runNext(now: string, completionAt: string): Promise<Execution | undefined>;
}

export interface ExecutionCoordinatorDependencies {
  readonly queue: ExecutionQueue;
  readonly runner: ExecutionRunner;
  readonly executions: ExecutionStore;
}

export type ExecutionCoordinatorErrorKind =
  | "EXECUTION_NOT_PERSISTED"
  | "PERSISTED_EXECUTION_NOT_QUEUED";

export class ExecutionCoordinatorError extends Error {
  readonly kind: ExecutionCoordinatorErrorKind;

  constructor(kind: ExecutionCoordinatorErrorKind, message: string) {
    super(message);
    this.name = "ExecutionCoordinatorError";
    this.kind = kind;
  }
}

export class InMemoryExecutionCoordinator implements ExecutionCoordinator {
  constructor(
    private readonly dependencies: ExecutionCoordinatorDependencies,
  ) {}

  async runNext(now: string, completionAt: string): Promise<Execution | undefined> {
    const queued = this.dependencies.queue.dequeue();

    if (queued === undefined) {
      return undefined;
    }

    const persisted = this.dependencies.executions.get(queued.id);

    if (persisted === undefined) {
      throw new ExecutionCoordinatorError(
        "EXECUTION_NOT_PERSISTED",
        `Cannot run execution that is not persisted: ${queued.id}.`,
      );
    }

    if (persisted.status !== "QUEUED") {
      throw new ExecutionCoordinatorError(
        "PERSISTED_EXECUTION_NOT_QUEUED",
        `Cannot run persisted execution ${queued.id} with status: ${persisted.status}.`,
      );
    }

    const running = startExecution(persisted, now);
    this.dependencies.executions.save(running);

    try {
      const result = await this.dependencies.runner.run(running);

      const completed = completeExecution(
        running,
        result.status === "FAILED"
          ? {
              status: "FAILED",
              completedAt: completionAt,
              error: result.error,
            }
          : {
              status: "SUCCEEDED",
              completedAt: completionAt,
            },
      );

      this.dependencies.executions.save(completed);

      return completed;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Execution runner failed.";

      const failed = completeExecution(running, {
        status: "FAILED",
        completedAt: completionAt,
        error: message,
      });

      this.dependencies.executions.save(failed);

      return failed;
    }
  }
}
