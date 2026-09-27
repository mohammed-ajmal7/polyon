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
  readonly maxConcurrency?: number;
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
  readonly activeExecutionCount: number;
  start(): ExecutionWorkerStartResult;
  stop(): void;
  runNext(): Promise<ExecutionRunOutcome | undefined>;
  recoveredExecutionIds(): readonly ExecutionId[];
}

const DEFAULT_POLL_INTERVAL_MS = 250;
const DEFAULT_MAX_CONCURRENCY = 1;

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

function validateMaxConcurrency(maxConcurrency: number): void {
  if (!Number.isInteger(maxConcurrency) || maxConcurrency < 1) {
    throw new Error("Execution runtime max concurrency must be a positive integer.");
  }
}

export function createExecutionRuntime(
  dependencies: ExecutionRuntimeDependencies,
): ExecutionRuntime {
  const pollIntervalMs = dependencies.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const maxConcurrency =
    dependencies.maxConcurrency ?? DEFAULT_MAX_CONCURRENCY;
  const wait = dependencies.wait ?? defaultWait;

  validatePollInterval(pollIntervalMs);
  validateMaxConcurrency(maxConcurrency);

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
  let activeExecutionCount = 0;
  let runtimeGeneration = 0;
  let wakeWaiter: (() => void) | undefined;

  const signalLoop = (): void => {
    const resolve = wakeWaiter;
    wakeWaiter = undefined;
    resolve?.();
  };

  const waitForLoop = async (): Promise<void> => {
    const timer = wait(pollIntervalMs);
    const wake = new Promise<void>((resolve) => {
      wakeWaiter = resolve;
    });

    await Promise.race([timer, wake]);

    if (wakeWaiter !== undefined) {
      wakeWaiter = undefined;
    }
  };

  const runOne = (): void => {
    activeExecutionCount += 1;

    void worker
      .runNext()
      .catch((error: unknown) => {
        dependencies.onError?.(error);
      })
      .finally(() => {
        activeExecutionCount -= 1;
        signalLoop();
      });
  };

  const runLoop = async (generation: number): Promise<void> => {
    while (
      runtimeStatus === "RUNNING" &&
      runtimeGeneration === generation
    ) {
      while (
        runtimeStatus === "RUNNING" &&
        runtimeGeneration === generation &&
        activeExecutionCount < maxConcurrency &&
        queue.size() > 0
      ) {
        runOne();
      }

      await waitForLoop();
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
    runtimeGeneration += 1;
    runtimeStatus = "RUNNING";
    const generation = runtimeGeneration;

    void runLoop(generation).catch((error: unknown) => {
      dependencies.onError?.(error);

      if (runtimeGeneration === generation) {
        runtimeStatus = "STOPPED";
        worker.stop();
      }
    });

    return startup;
  };

  const stop = (): void => {
    runtimeGeneration += 1;
    runtimeStatus = "STOPPED";
    worker.stop();
    signalLoop();
  };

  const runNext = async (): Promise<ExecutionRunOutcome | undefined> =>
    worker.runNext();

  return {
    queue,
    coordinator,
    worker,
    get status(): ExecutionRuntimeStatus {
      return runtimeStatus;
    },
    get activeExecutionCount(): number {
      return activeExecutionCount;
    },
    start,
    stop,
    runNext,
    recoveredExecutionIds(): readonly ExecutionId[] {
      return recoveredExecutionIds;
    },
  };
}
