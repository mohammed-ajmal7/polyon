import type {
  DomainEvent,
  Execution,
  ExecutionStatus,
  Task,
  TaskStatus,
} from "@polyon/contracts";

import { completeExecution, startExecution, transitionTaskStatus } from "@polyon/core";

import type { EventStore, ExecutionStore, TaskStore } from "@polyon/storage";

import type { ExecutionQueue } from "./execution-queue";
import type {
  ExecutionRunContext,
  ExecutionRunResult,
  ExecutionRunner,
} from "./execution-runner";

export interface ExecutionRunOutcome {
  readonly execution: Execution;
  readonly result: ExecutionRunResult;
}

export interface ExecutionCoordinator {
  runNext(
    now: string,
    completionAt: string,
    context?: ExecutionRunContext,
  ): Promise<Execution | undefined>;
  runNextWithResult(
    now: string,
    completionAt: string,
    context?: ExecutionRunContext,
  ): Promise<ExecutionRunOutcome | undefined>;
}

export interface ExecutionCoordinatorDependencies {
  readonly queue: ExecutionQueue;
  readonly runner: ExecutionRunner;
  readonly executions: ExecutionStore;
  readonly tasks: TaskStore;
  readonly events: EventStore;
}

function appendExecutionStatusChangedEvent(
  events: EventStore,
  execution: Execution,
  from: ExecutionStatus,
  to: ExecutionStatus,
  occurredAt: string,
  error?: string,
): void {
  const event: DomainEvent = {
    id: `EXECUTION_STATUS_CHANGED:${execution.id}:${from}:${to}:${occurredAt}`,
    kind: "EXECUTION_STATUS_CHANGED",
    actorId: execution.actorId,
    missionId: execution.missionId,
    taskId: execution.taskId,
    executionId: execution.id,
    occurredAt,
    data: {
      from,
      to,
      ...(error !== undefined ? { error } : {}),
    },
  };

  events.append(event);
}

function appendTaskStatusChangedEvent(
  events: EventStore,
  task: Task,
  from: TaskStatus,
  to: TaskStatus,
  occurredAt: string,
): void {
  const event: DomainEvent = {
    id: `TASK_STATUS_CHANGED:${task.id}:${from}:${to}:${occurredAt}`,
    kind: "TASK_STATUS_CHANGED",
    missionId: task.missionId,
    taskId: task.id,
    occurredAt,
    data: {
      from,
      to,
    },
  };

  events.append(event);
}

export type ExecutionCoordinatorErrorKind =
  | "EXECUTION_NOT_PERSISTED"
  | "PERSISTED_EXECUTION_NOT_QUEUED"
  | "TASK_NOT_PERSISTED"
  | "TASK_STATE_NOT_EXECUTABLE";

export class ExecutionCoordinatorError extends Error {
  readonly kind: ExecutionCoordinatorErrorKind;

  constructor(kind: ExecutionCoordinatorErrorKind, message: string) {
    super(message);
    this.name = "ExecutionCoordinatorError";
    this.kind = kind;
  }
}

export class InMemoryExecutionCoordinator implements ExecutionCoordinator {
  constructor(private readonly dependencies: ExecutionCoordinatorDependencies) {}

  async runNext(
    now: string,
    completionAt: string,
    context?: ExecutionRunContext,
  ): Promise<Execution | undefined> {
    const outcome = await this.runNextWithResult(now, completionAt, context);
    return outcome?.execution;
  }

  async runNextWithResult(
    now: string,
    completionAt: string,
    context?: ExecutionRunContext,
  ): Promise<ExecutionRunOutcome | undefined> {
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

    if (persisted.status === "CANCELLED") {
      return {
        execution: persisted,
        result: {
          status: "CANCELLED",
          error: persisted.error ?? "Execution was cancelled.",
        },
      };
    }

    if (persisted.status !== "QUEUED") {
      throw new ExecutionCoordinatorError(
        "PERSISTED_EXECUTION_NOT_QUEUED",
        `Cannot run persisted execution ${queued.id} with status: ${persisted.status}.`,
      );
    }

    const task = this.dependencies.tasks.get(persisted.taskId);

    if (task === undefined) {
      throw new ExecutionCoordinatorError(
        "TASK_NOT_PERSISTED",
        `Cannot run execution ${persisted.id} because task is not persisted: ${persisted.taskId}.`,
      );
    }

    if (task.missionId !== persisted.missionId) {
      throw new ExecutionCoordinatorError(
        "TASK_STATE_NOT_EXECUTABLE",
        "Persisted task mission does not match the execution mission.",
      );
    }

    const runningTask =
      task.status === "APPROVED"
        ? transitionTaskStatus(task, "RUNNING", now)
        : task.status === "RUNNING"
          ? task
          : undefined;

    if (runningTask === undefined) {
      throw new ExecutionCoordinatorError(
        "TASK_STATE_NOT_EXECUTABLE",
        `Cannot run execution ${persisted.id} while task status is ${task.status}.`,
      );
    }

    const running = startExecution(persisted, now);
    this.dependencies.tasks.save(runningTask);
    this.dependencies.executions.save(running);

    if (task.status !== runningTask.status) {
      appendTaskStatusChangedEvent(
        this.dependencies.events,
        runningTask,
        task.status,
        runningTask.status,
        now,
      );
    }
    appendExecutionStatusChangedEvent(
      this.dependencies.events,
      running,
      persisted.status,
      running.status,
      now,
    );

    try {
      const result = await this.dependencies.runner.run(running, context);
      const persistedAfterRun = this.dependencies.executions.get(running.id);

      if (persistedAfterRun?.status === "CANCELLED") {
        return {
          execution: persistedAfterRun,
          result: {
            status: "CANCELLED",
            error: persistedAfterRun.error ?? "Execution was cancelled.",
          },
        };
      }

      const abortReason = context?.getAbortReason();
      const effectiveResult: ExecutionRunResult =
        abortReason === "TIMEOUT"
          ? {
              status: "FAILED",
              error: "Execution timed out after the runtime execution deadline.",
            }
          : abortReason === "CANCELLED"
            ? {
                status: "CANCELLED",
                error: "Execution was cancelled.",
              }
            : result;

      const completed = completeExecution(
        running,
        effectiveResult.status === "FAILED"
          ? {
              status: "FAILED",
              completedAt: completionAt,
              error: effectiveResult.error,
            }
          : {
              status: effectiveResult.status,
              completedAt: completionAt,
            },
      );

      const completedTask = transitionTaskStatus(
        runningTask,
        completed.status === "SUCCEEDED"
          ? "SUCCEEDED"
          : completed.status === "FAILED"
            ? "FAILED"
            : "CANCELLED",
        completionAt,
      );

      this.dependencies.executions.save(completed);
      this.dependencies.tasks.save(completedTask);
      appendExecutionStatusChangedEvent(
        this.dependencies.events,
        completed,
        running.status,
        completed.status,
        completionAt,
        effectiveResult.status === "FAILED" ? effectiveResult.error : undefined,
      );
      appendTaskStatusChangedEvent(
        this.dependencies.events,
        completedTask,
        runningTask.status,
        completedTask.status,
        completionAt,
      );

      return {
        execution: completed,
        result: effectiveResult,
      };
    } catch (error) {
      const persistedAfterError = this.dependencies.executions.get(running.id);

      if (persistedAfterError?.status === "CANCELLED") {
        return {
          execution: persistedAfterError,
          result: {
            status: "CANCELLED",
            error: persistedAfterError.error ?? "Execution was cancelled.",
          },
        };
      }

      const abortReason = context?.getAbortReason();
      if (abortReason === "CANCELLED") {
        const cancelled = completeExecution(running, {
          status: "CANCELLED",
          completedAt: completionAt,
        });
        const cancelledTask = transitionTaskStatus(
          runningTask,
          "CANCELLED",
          completionAt,
        );
        this.dependencies.executions.save(cancelled);
        this.dependencies.tasks.save(cancelledTask);
        appendExecutionStatusChangedEvent(
          this.dependencies.events,
          cancelled,
          running.status,
          cancelled.status,
          completionAt,
          undefined,
        );
        appendTaskStatusChangedEvent(
          this.dependencies.events,
          cancelledTask,
          runningTask.status,
          cancelledTask.status,
          completionAt,
        );
        return {
          execution: cancelled,
          result: {
            status: "CANCELLED",
            error: "Execution was cancelled.",
          },
        };
      }

      const message =
        abortReason === "TIMEOUT"
          ? "Execution timed out after the runtime execution deadline."
          : error instanceof Error
            ? error.message
            : "Execution runner failed.";

      const failed = completeExecution(running, {
        status: "FAILED",
        completedAt: completionAt,
        error: message,
      });

      const failedTask = transitionTaskStatus(runningTask, "FAILED", completionAt);

      this.dependencies.executions.save(failed);
      this.dependencies.tasks.save(failedTask);
      appendExecutionStatusChangedEvent(
        this.dependencies.events,
        failed,
        running.status,
        failed.status,
        completionAt,
        message,
      );
      appendTaskStatusChangedEvent(
        this.dependencies.events,
        failedTask,
        runningTask.status,
        failedTask.status,
        completionAt,
      );

      return {
        execution: failed,
        result: {
          status: "FAILED",
          error: message,
        },
      };
    }
  }
}
