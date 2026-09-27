import type { Execution, ExecutionId, Task } from "@polyon/contracts";
import { cancelExecution, transitionTaskStatus } from "@polyon/core";

import type {
  DomainStoreTransactionContext,
  DomainUnitOfWork,
  EventStore,
  ExecutionStore,
  TaskStore,
} from "@polyon/storage";

import {
  InMemoryExecutionCoordinator,
  type ExecutionCoordinator,
  type ExecutionRunOutcome,
} from "./execution-coordinator";
import { InMemoryExecutionQueue, type ExecutionQueue } from "./execution-queue";
import type {
  ExecutionAbortReason,
  ExecutionRunContext,
  ExecutionRunner,
} from "./execution-runner";
import {
  InMemoryExecutionWorker,
  type ExecutionWorkerClock,
  type ExecutionWorkerStartResult,
} from "./execution-worker";

export type ExecutionRuntimeStatus = "STOPPED" | "RUNNING";

export type ExecutionRuntimeCancellationResult =
  | { readonly status: "CANCELLED"; readonly execution: Execution }
  | { readonly status: "NOT_FOUND"; readonly executionId: ExecutionId }
  | { readonly status: "NOT_CANCELLABLE"; readonly execution: Execution };

export interface ExecutionRuntimeHealth {
  readonly status: ExecutionRuntimeStatus;
  readonly queuedExecutionCount: number;
  readonly activeExecutionCount: number;
  readonly recoveredExecutionCount: number;
  readonly consecutiveErrorCount: number;
  readonly retryBackoffMs: number;
  readonly lastError?: string;
  readonly lastActivityAt?: string;
  readonly lastRecoveryAt?: string;
}

export type ExecutionRuntimeWait = (milliseconds: number) => Promise<void>;
export type ExecutionRuntimeCompletionHandler = (
  outcome: ExecutionRunOutcome,
) => void | Promise<void>;

export interface ExecutionRuntimeDependencies {
  readonly runner: ExecutionRunner;
  readonly executions: ExecutionStore;
  readonly tasks: TaskStore;
  readonly events: EventStore;
  readonly clock: ExecutionWorkerClock;
  readonly pollIntervalMs?: number;
  readonly maxConcurrency?: number;
  readonly executionTimeoutMs?: number;
  readonly retryBackoffInitialMs?: number;
  readonly retryBackoffMaxMs?: number;
  readonly wait?: ExecutionRuntimeWait;
  readonly onError?: (error: unknown) => void;
  readonly onExecutionCompleted?: ExecutionRuntimeCompletionHandler;
  readonly unitOfWork?: DomainUnitOfWork;
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
  readonly health: ExecutionRuntimeHealth;
  start(): ExecutionWorkerStartResult;
  stop(): void;
  runNext(): Promise<ExecutionRunOutcome | undefined>;
  cancel(executionId: ExecutionId): ExecutionRuntimeCancellationResult;
  recoveredExecutionIds(): readonly ExecutionId[];
}

const DEFAULT_POLL_INTERVAL_MS = 250;
const DEFAULT_MAX_CONCURRENCY = 1;
const DEFAULT_RETRY_BACKOFF_INITIAL_MS = 250;
const DEFAULT_RETRY_BACKOFF_MAX_MS = 5_000;

interface ActiveExecutionControl {
  readonly controller: AbortController;
  readonly getAbortReason: () => ExecutionAbortReason | undefined;
  reason?: ExecutionAbortReason;
  timeout?: ReturnType<typeof globalThis.setTimeout>;
}

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

function validateExecutionTimeout(timeoutMs: number | undefined): void {
  if (
    timeoutMs !== undefined &&
    (!Number.isFinite(timeoutMs) || timeoutMs <= 0)
  ) {
    throw new Error("Execution runtime timeout must be a positive finite number.");
  }
}

function validateRetryBackoff(initialMs: number, maxMs: number): void {
  if (!Number.isFinite(initialMs) || initialMs <= 0) {
    throw new Error(
      "Execution runtime retry backoff initial delay must be a positive finite number.",
    );
  }

  if (!Number.isFinite(maxMs) || maxMs <= 0) {
    throw new Error(
      "Execution runtime retry backoff maximum delay must be a positive finite number.",
    );
  }

  if (maxMs < initialMs) {
    throw new Error(
      "Execution runtime retry backoff maximum delay must be greater than or equal to the initial delay.",
    );
  }
}

type RuntimeCancellationStores = Pick<
  DomainStoreTransactionContext,
  "executions" | "tasks" | "events"
>;

function appendExecutionCancellationEvent(
  events: EventStore,
  execution: Execution,
  from: Execution["status"],
): void {
  events.append({
    id: `EXECUTION_STATUS_CHANGED:${execution.id}:${from}:CANCELLED:${execution.updatedAt}:RUNTIME`,
    kind: "EXECUTION_STATUS_CHANGED",
    actorId: execution.actorId,
    missionId: execution.missionId,
    taskId: execution.taskId,
    executionId: execution.id,
    occurredAt: execution.updatedAt,
    data: {
      from,
      to: "CANCELLED",
      reason: "RUNTIME_CANCELLED",
    },
  });
}

function appendTaskCancellationEvent(
  events: EventStore,
  task: Task,
  from: Task["status"],
): void {
  events.append({
    id: `TASK_STATUS_CHANGED:${task.id}:${from}:CANCELLED:${task.updatedAt}:RUNTIME`,
    kind: "TASK_STATUS_CHANGED",
    missionId: task.missionId,
    taskId: task.id,
    occurredAt: task.updatedAt,
    data: {
      from,
      to: "CANCELLED",
      reason: "RUNTIME_CANCELLED",
    },
  });
}

export function createExecutionRuntime(
  dependencies: ExecutionRuntimeDependencies,
): ExecutionRuntime {
  const pollIntervalMs = dependencies.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const maxConcurrency =
    dependencies.maxConcurrency ?? DEFAULT_MAX_CONCURRENCY;
  const retryBackoffInitialMs =
    dependencies.retryBackoffInitialMs ?? DEFAULT_RETRY_BACKOFF_INITIAL_MS;
  const retryBackoffMaxMs =
    dependencies.retryBackoffMaxMs ?? DEFAULT_RETRY_BACKOFF_MAX_MS;
  const wait = dependencies.wait ?? defaultWait;

  validatePollInterval(pollIntervalMs);
  validateMaxConcurrency(maxConcurrency);
  validateExecutionTimeout(dependencies.executionTimeoutMs);
  validateRetryBackoff(retryBackoffInitialMs, retryBackoffMaxMs);

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
  let recoveredExecutionCount = 0;
  let consecutiveErrorCount = 0;
  let retryBackoffMs = 0;
  let retryBackoffPending = false;
  let lastError: string | undefined;
  let lastActivityAt: string | undefined;
  let lastRecoveryAt: string | undefined;
  const activeExecutions = new Map<ExecutionId, ActiveExecutionControl>();

  const signalLoop = (): void => {
    const resolve = wakeWaiter;
    wakeWaiter = undefined;
    resolve?.();
  };

  const waitForLoop = async (milliseconds: number): Promise<void> => {
    const currentWaiter = () => {
      if (wakeWaiter === currentWaiter) {
        wakeWaiter = undefined;
      }
    };

    const wake = new Promise<void>((resolve) => {
      wakeWaiter = () => {
        currentWaiter();
        resolve();
      };
    });

    await Promise.race([wait(milliseconds), wake]);
    currentWaiter();
  };

  const recordError = (error: unknown): void => {
    consecutiveErrorCount += 1;
    retryBackoffMs =
      retryBackoffMs === 0
        ? retryBackoffInitialMs
        : Math.min(retryBackoffMs * 2, retryBackoffMaxMs);
    retryBackoffPending = true;
    lastError = error instanceof Error ? error.message : String(error);
    lastActivityAt = dependencies.clock.now();
  };

  const notifyCompletion = (outcome: ExecutionRunOutcome | undefined): void => {
    if (outcome === undefined || dependencies.onExecutionCompleted === undefined) {
      return;
    }

    void Promise.resolve()
      .then(() => dependencies.onExecutionCompleted?.(outcome))
      .catch((error: unknown) => {
        recordError(error);
        dependencies.onError?.(error);
      });
  };

  const resetErrorState = (): void => {
    consecutiveErrorCount = 0;
    retryBackoffMs = 0;
    retryBackoffPending = false;
    lastError = undefined;
    lastActivityAt = dependencies.clock.now();
  };

  const runOne = (): void => {
    const queued = queue.peek();

    if (queued === undefined) {
      return;
    }

    const control: ActiveExecutionControl = {
      controller: new AbortController(),
      getAbortReason: () => control.reason,
    };

    activeExecutions.set(queued.id, control);
    activeExecutionCount += 1;
    lastActivityAt = dependencies.clock.now();

    if (dependencies.executionTimeoutMs !== undefined) {
      control.timeout = globalThis.setTimeout(() => {
        control.reason = "TIMEOUT";
        control.controller.abort();
      }, dependencies.executionTimeoutMs);
    }

    const context: ExecutionRunContext = {
      signal: control.controller.signal,
      getAbortReason: control.getAbortReason,
    };

    void worker
      .runNext(context)
      .then((outcome) => {
        notifyCompletion(outcome);
        if (consecutiveErrorCount > 0) {
          resetErrorState();
        } else {
          lastActivityAt = dependencies.clock.now();
        }
      })
      .catch((error: unknown) => {
        recordError(error);
        dependencies.onError?.(error);
      })
      .finally(() => {
        if (control.timeout !== undefined) {
          globalThis.clearTimeout(control.timeout);
        }
        activeExecutions.delete(queued.id);
        activeExecutionCount -= 1;
        signalLoop();
      });
  };

  const runLoop = async (generation: number): Promise<void> => {
    while (
      runtimeStatus === "RUNNING" &&
      runtimeGeneration === generation
    ) {
      if (retryBackoffPending) {
        await waitForLoop(retryBackoffMs);
        retryBackoffPending = false;
        continue;
      }

      while (
        runtimeStatus === "RUNNING" &&
        runtimeGeneration === generation &&
        activeExecutionCount < maxConcurrency &&
        queue.size() > 0
      ) {
        runOne();
      }

      await waitForLoop(pollIntervalMs);
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
    recoveredExecutionCount += startup.recoveredExecutionIds.length;
    if (startup.recoveredExecutionIds.length > 0) {
      lastRecoveryAt = dependencies.clock.now();
      lastActivityAt = lastRecoveryAt;
    }
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

  const cancel = (
    executionId: ExecutionId,
  ): ExecutionRuntimeCancellationResult => {
    const execution = dependencies.executions.get(executionId);

    if (execution === undefined) {
      return { status: "NOT_FOUND", executionId };
    }

    if (execution.status !== "QUEUED" && execution.status !== "RUNNING") {
      return { status: "NOT_CANCELLABLE", execution };
    }

    const task = dependencies.tasks.get(execution.taskId);

    if (task === undefined) {
      throw new Error(
        `Cannot cancel execution ${execution.id} because task is not persisted: ${execution.taskId}.`,
      );
    }

    const operation = (stores: RuntimeCancellationStores): Execution => {
      const updatedExecution = cancelExecution(
        execution,
        dependencies.clock.now(),
      );
      const updatedTask = transitionTaskStatus(
        task,
        "CANCELLED",
        updatedExecution.updatedAt,
      );

      stores.executions.save(updatedExecution);
      stores.tasks.save(updatedTask);
      appendExecutionCancellationEvent(
        stores.events,
        updatedExecution,
        execution.status,
      );
      appendTaskCancellationEvent(
        stores.events,
        updatedTask,
        task.status,
      );

      return updatedExecution;
    };

    const cancelled =
      dependencies.unitOfWork === undefined
        ? operation(dependencies)
        : dependencies.unitOfWork.transaction(operation);

    queue.remove(executionId);

    const active = activeExecutions.get(executionId);
    if (active !== undefined) {
      active.reason = "CANCELLED";
      active.controller.abort();
    }

    lastActivityAt = cancelled.updatedAt;
    signalLoop();

    return { status: "CANCELLED", execution: cancelled };
  };

  const runNext = async (): Promise<ExecutionRunOutcome | undefined> => {
    const outcome = await worker.runNext();
    notifyCompletion(outcome);
    return outcome;
  };

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
    get health(): ExecutionRuntimeHealth {
      return {
        status: runtimeStatus,
        queuedExecutionCount: queue.size(),
        activeExecutionCount,
        recoveredExecutionCount,
        consecutiveErrorCount,
        retryBackoffMs,
        ...(lastError === undefined ? {} : { lastError }),
        ...(lastActivityAt === undefined ? {} : { lastActivityAt }),
        ...(lastRecoveryAt === undefined ? {} : { lastRecoveryAt }),
      };
    },
    start,
    stop,
    runNext,
    cancel,
    recoveredExecutionIds(): readonly ExecutionId[] {
      return recoveredExecutionIds;
    },
  };
}
