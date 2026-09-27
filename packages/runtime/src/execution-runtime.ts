import type { ExecutionId } from "@polyon/contracts";

import type { EventStore, ExecutionStore, TaskStore } from "@polyon/storage";

import {
  InMemoryExecutionCoordinator,
  type ExecutionCoordinator,
  type ExecutionRunOutcome,
} from "./execution-coordinator";
import { InMemoryExecutionQueue, type ExecutionQueue } from "./execution-queue";
import type { ExecutionRunner } from "./execution-runner";
import {
  InMemoryExecutionWorker,
  type ExecutionWorkerClock,
  type ExecutionWorkerStartResult,
} from "./execution-worker";

export interface ExecutionRuntimeDependencies {
  readonly runner: ExecutionRunner;
  readonly executions: ExecutionStore;
  readonly tasks: TaskStore;
  readonly events: EventStore;
  readonly clock: ExecutionWorkerClock;
}

export interface ExecutionRuntime {
  readonly queue: ExecutionQueue;
  readonly coordinator: ExecutionCoordinator;
  readonly worker: {
    readonly running: boolean;
    start(): ExecutionWorkerStartResult;
    stop(): void;
    runNext(): Promise<ExecutionRunOutcome | undefined>;
    drain(): Promise<readonly import("@polyon/contracts").Execution[]>;
  };
  readonly start: () => ExecutionWorkerStartResult;
  readonly stop: () => void;
  readonly recoveredExecutionIds: () => readonly ExecutionId[];
}

export function createExecutionRuntime(
  dependencies: ExecutionRuntimeDependencies,
): ExecutionRuntime {
  const queue = new InMemoryExecutionQueue();
  const coordinator = new InMemoryExecutionCoordinator({
    queue,
    runner: dependencies.runner,
    executions: dependencies.executions,
    tasks: dependencies.tasks,
    events: dependencies.events,
  });
  const worker = new InMemoryExecutionWorker({
    queue,
    coordinator,
    executions: dependencies.executions,
    events: dependencies.events,
    clock: dependencies.clock,
  });

  let recoveredExecutionIds: readonly ExecutionId[] = [];

  return {
    queue,
    coordinator,
    worker,
    start(): ExecutionWorkerStartResult {
      const startup = worker.start();
      recoveredExecutionIds = startup.recoveredExecutionIds;
      return startup;
    },
    stop(): void {
      worker.stop();
    },
    recoveredExecutionIds(): readonly ExecutionId[] {
      return recoveredExecutionIds;
    },
  };
}
