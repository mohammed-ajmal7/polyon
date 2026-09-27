import type { Execution, ExecutionId } from "@polyon/contracts";

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

export type ExecutionRuntimeStatus = "STOPPED" | "RUNNING";

export type ExecutionRuntimeWait = (milliseconds: number) => Promise<void>;

export interface ExecutionRuntimeDependencies {
  readonly runner: ExecutionRunner;
  readonly executions: ExecutionStore;
  readonly tasks: TaskStore;
  readonly events: EventStore;
  readonly clock: ExecutionWorkerClock;
  readonly pollIntervalMs?: number;
  readonly wait?: ExecutionRuntimeWait;
  readonly onError?: (error: unknown) => void;
}

export interface ExecutionRuntime {
  readonly queue: ExecutionQueue;
  readonly coordinator: ExecutionCoordinator;
  readonly worker: {
    readonly running: boolean;
    start(): ExecutionWorkerStartResult;
    stop(): void;
    runNext(): Promise<ExecutionRunOutcome | undefined>;
    drain(): Promise<readonly Execution[]>;
  };
  readonly status: ExecutionRuntimeStatus;
  start(): ExecutionWorkerStartResult;
  stop(): void;
  runNext(): Promise<ExecutionRunOutcome | undefined>;
  recoveredExecutionIds(): readonly ExecutionId[];
}

const DEFAULT_POLL_INTERVAL_MS = 250;

function defaultWait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    globalThis.setTimeout(resolve, milliseconds);
  });
}

function validatePollInterval(milliseconds: number): void {
  if (!Number.isFinite(milliseconds) || milliseconds < 0) {
    throw new Error("Execution runtime poll interval must be a finite non-negative number.");
  }
}

export function createExecutionRuntime(
  dependencies: ExecutionRuntimeDependencies,
): ExecutionRuntime {
  const pollIntervalMs = dependencies.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const wait = dependencies.wait ?? defaultWait;

  validatePollInterval(pollIntervalMs);

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

  let runtimeStatus: ExecutionRuntimeStatus = "STOPPED";
  let recoveredExecutionIds: readonly ExecutionId[] = [];

  const runLoop = async (): Promise<void> => {
    while (runtimeStatus === "RUNNING") {
      if (queue.size() === 0) {
        await wait(pollIntervalMs);
        continue;
      }

      try {
        await worker.runNext();
      } catch (error) {
        dependencies.onError?.(error);
        await wait(pollIntervalMs);
      }
    }
  };

  const start = (): ExecutionWorkerStartResult => {
    if (runtimeStatus === "RUNNING") {
      return {
        recoveredExecutionIds: [],
      };
    }

    const startup = worker.start();
    recoveredExecutionIds = startup.recoveredExecutionIds;
    runtimeStatus = "RUNNING";

    void runLoop().catch((error: unknown) => {
      dependencies.onError?.(error);
      runtimeStatus = "STOPPED";
      worker.stop();
    });

    return startup;
  };

  const stop = (): void => {
    runtimeStatus = "STOPPED";
    worker.stop();
  };

  const runNext = async (): Promise<ExecutionRunOutcome | undefined> => worker.runNext();

  return {
    queue,
    coordinator,
    worker,
    get status(): ExecutionRuntimeStatus {
      return runtimeStatus;
    },
    start,
    stop,
    runNext,
    recoveredExecutionIds(): readonly ExecutionId[] {
      return recoveredExecutionIds;
    },
  };
}
