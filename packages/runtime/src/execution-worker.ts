import type { DomainEvent, Execution, ExecutionId } from "@polyon/contracts";

import type {
  ApprovalRequestStore,
  EventStore,
  ExecutionStore,
} from "@polyon/storage";

import type {
  ExecutionCoordinator,
  ExecutionRunOutcome,
} from "./execution-coordinator";
import type { ExecutionRunContext } from "./execution-runner";
import {
  recoverExecutions,
  recoverQueuedExecutions,
} from "./execution-recovery";
import type { ExecutionQueue } from "./execution-queue";

export interface ExecutionWorkerClock {
  now(): string;
}

export interface ExecutionWorkerDependencies {
  readonly queue: ExecutionQueue;
  readonly coordinator: ExecutionCoordinator;
  readonly executions: ExecutionStore;
  readonly approvals?: ApprovalRequestStore;
  readonly events: EventStore;
  readonly clock: ExecutionWorkerClock;
}

export interface ExecutionWorkerStartResult {
  readonly recoveredExecutionIds: readonly ExecutionId[];
}

export type ExecutionWorkerStateErrorKind = "WORKER_NOT_RUNNING";

export class ExecutionWorkerStateError extends Error {
  readonly kind: ExecutionWorkerStateErrorKind;

  constructor(kind: ExecutionWorkerStateErrorKind) {
    super("Execution worker is not running.");
    this.name = "ExecutionWorkerStateError";
    this.kind = kind;
  }
}

export interface ExecutionWorker {
  readonly running: boolean;
  start(): ExecutionWorkerStartResult;
  stop(): void;
  runNext(
    context?: ExecutionRunContext,
  ): Promise<ExecutionRunOutcome | undefined>;
  drain(): Promise<readonly Execution[]>;
}

function appendRecoveryEvent(
  events: EventStore,
  executions: ExecutionStore,
  executionId: ExecutionId,
  reason:
    | "PROCESS_STARTUP"
    | "RESUMABLE_TOOL_CONTINUATION_RESTART"
    | "PENDING_TOOL_APPROVAL_RESTART",
): void {
  const execution = executions.get(executionId);

  if (execution === undefined) {
    return;
  }

  const eventId = `EXECUTION_RECOVERED:${execution.id}:${execution.attempt}:${reason}`;

  if (events.get(eventId) !== undefined) {
    return;
  }

  const event: DomainEvent = {
    id: eventId,
    kind: "EXECUTION_RECOVERED",
    actorId: execution.actorId,
    missionId: execution.missionId,
    taskId: execution.taskId,
    executionId: execution.id,
    occurredAt: execution.updatedAt,
    data: {
      attempt: execution.attempt,
      status: execution.status,
      reason,
    },
  };

  events.append(event);
}

export class InMemoryExecutionWorker implements ExecutionWorker {
  private started = false;

  constructor(private readonly dependencies: ExecutionWorkerDependencies) {}

  get running(): boolean {
    return this.started;
  }

  start(): ExecutionWorkerStartResult {
    if (this.started) {
      return { recoveredExecutionIds: [] };
    }

    const recoveries = recoverExecutions(
      this.dependencies.executions,
      this.dependencies.queue,
      this.dependencies.approvals,
      this.dependencies.clock.now(),
    );
    const recoveredExecutionIds = recoveries.map(
      (recovery) => recovery.executionId,
    );

    for (const recovery of recoveries) {
      appendRecoveryEvent(
        this.dependencies.events,
        this.dependencies.executions,
        recovery.executionId,
        recovery.kind === "INTERRUPTED_TOOL_CONTINUATION"
          ? "RESUMABLE_TOOL_CONTINUATION_RESTART"
          : recovery.kind === "PENDING_TOOL_APPROVAL_RESTART"
            ? "PENDING_TOOL_APPROVAL_RESTART"
            : "PROCESS_STARTUP",
      );
    }

    this.started = true;

    return { recoveredExecutionIds };
  }

  stop(): void {
    this.started = false;
  }

  async runNext(
    context?: ExecutionRunContext,
  ): Promise<ExecutionRunOutcome | undefined> {
    this.assertRunning();

    try {
      return await this.dependencies.coordinator.runNextWithResult(
        this.dependencies.clock.now(),
        this.dependencies.clock.now(),
        context,
      );
    } catch (error) {
      recoverQueuedExecutions(
        this.dependencies.executions,
        this.dependencies.queue,
      );
      throw error;
    }
  }

  async drain(): Promise<readonly Execution[]> {
    this.assertRunning();

    const completed: Execution[] = [];

    while (this.dependencies.queue.size() > 0) {
      const outcome = await this.runNext();

      if (outcome !== undefined) {
        completed.push(outcome.execution);
      }
    }

    return completed;
  }

  private assertRunning(): void {
    if (!this.started) {
      throw new ExecutionWorkerStateError("WORKER_NOT_RUNNING");
    }
  }
}
