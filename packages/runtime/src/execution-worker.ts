import type { DomainEvent, Execution, ExecutionId } from "@polyon/contracts";

import type { EventStore, ExecutionStore } from "@polyon/storage";

import type {
  ExecutionCoordinator,
  ExecutionRunOutcome,
} from "./execution-coordinator";
import { recoverQueuedExecutions } from "./execution-recovery";
import type { ExecutionQueue } from "./execution-queue";

export interface ExecutionWorkerClock {
  now(): string;
}

export interface ExecutionWorkerDependencies {
  readonly queue: ExecutionQueue;
  readonly coordinator: ExecutionCoordinator;
  readonly executions: ExecutionStore;
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
  runNext(): Promise<ExecutionRunOutcome | undefined>;
  drain(): Promise<readonly Execution[]>;
}

function appendRecoveryEvent(
  events: EventStore,
  executions: ExecutionStore,
  executionId: ExecutionId,
): void {
  const execution = executions.get(executionId);

  if (execution === undefined) {
    return;
  }

  const eventId = `EXECUTION_RECOVERED:${execution.id}:${execution.updatedAt}`;

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
      reason: "PROCESS_STARTUP",
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

    const recoveredExecutionIds = recoverQueuedExecutions(
      this.dependencies.executions,
      this.dependencies.queue,
    );

    for (const executionId of recoveredExecutionIds) {
      appendRecoveryEvent(
        this.dependencies.events,
        this.dependencies.executions,
        executionId,
      );
    }

    this.started = true;

    return { recoveredExecutionIds };
  }

  stop(): void {
    this.started = false;
  }

  async runNext(): Promise<ExecutionRunOutcome | undefined> {
    this.assertRunning();

    try {
      return await this.dependencies.coordinator.runNextWithResult(
        this.dependencies.clock.now(),
        this.dependencies.clock.now(),
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
