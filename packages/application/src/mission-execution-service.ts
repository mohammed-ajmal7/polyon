import type {
  ActorId,
  AgentId,
  CapabilityId,
  DomainEvent,
  Mission,
  Policy,
  Task,
  TaskStatus,
} from "@polyon/contracts";

import {
  getReadyTaskIds,
  markTaskReady,
  transitionTaskStatus,
  validateMissionTaskPlan,
  type TaskDependency,
} from "@polyon/core";

import type { EventStore } from "@polyon/storage";

import type { ExecutionDispatchPlan } from "./execution-dispatch";
import { ExecutionDispatchService } from "./execution-dispatch-service";

function appendTaskStatusChangedEvent(
  events: EventStore,
  task: Task,
  from: TaskStatus,
  to: TaskStatus,
  actorId: ActorId,
  occurredAt: string,
): void {
  const event: DomainEvent = {
    id: `TASK_STATUS_CHANGED:${task.id}:${from}:${to}:${occurredAt}`,
    kind: "TASK_STATUS_CHANGED",
    actorId,
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

function validateDispatchTasks(mission: Mission, tasks: readonly Task[]): void {
  const taskIds = new Set<string>();
  const missionTaskIds = new Set(mission.taskIds);

  for (const task of tasks) {
    if (taskIds.has(task.id)) {
      throw new MissionExecutionValidationError([
        { kind: "DUPLICATE_MISSION_TASK_ID", taskId: task.id },
      ]);
    }

    taskIds.add(task.id);

    if (task.missionId !== mission.id) {
      throw new MissionExecutionValidationError([
        {
          kind: "TASK_MISSION_MISMATCH",
          taskId: task.id,
          expectedMissionId: mission.id,
          actualMissionId: task.missionId,
        },
      ]);
    }

    if (!missionTaskIds.has(task.id)) {
      throw new MissionExecutionValidationError([
        { kind: "UNDECLARED_MISSION_TASK", taskId: task.id },
      ]);
    }
  }

  const hasCompleteMissionTaskSet =
    taskIds.size === mission.taskIds.length &&
    mission.taskIds.every((taskId) => taskIds.has(taskId));

  if (hasCompleteMissionTaskSet) {
    const validation = validateMissionTaskPlan(mission, tasks);

    if (!validation.valid) {
      throw new MissionExecutionValidationError(validation.errors);
    }
  }
}

export interface ExecutionIdentityFactory {
  executionId(taskId: string, attempt: number): string;
  policyDecisionId(taskId: string, executionId: string): string;
  approvalRequestId(taskId: string, executionId: string): string;
}

export interface DispatchReadyTasksInput {
  readonly mission: Mission;
  readonly tasks: readonly Task[];
  readonly actorId: ActorId;
  readonly agentId?: AgentId;
  readonly requiredCapabilityIds?: readonly CapabilityId[];
  readonly policy: Policy;
  readonly requestedBy: ActorId;
  readonly now: string;
  readonly riskLevel: "LOW" | "MEDIUM" | "HIGH";
  readonly expiresAt?: string;
  readonly identities: ExecutionIdentityFactory;
}

export interface DispatchReadyTasksResult {
  readonly dispatched: readonly ExecutionDispatchPlan[];
  readonly awaitingApproval: readonly ExecutionDispatchPlan[];
  readonly rejected: readonly ExecutionDispatchPlan[];
}

export class MissionExecutionValidationError extends Error {
  readonly errors: ReturnType<typeof validateMissionTaskPlan>["errors"];

  constructor(errors: ReturnType<typeof validateMissionTaskPlan>["errors"]) {
    super("Cannot dispatch tasks for an invalid mission task plan.");
    this.name = "MissionExecutionValidationError";
    this.errors = errors;
  }
}

export class MissionExecutionService {
  constructor(
    private readonly executionDispatch: ExecutionDispatchService,
    private readonly saveTask: (task: Task) => void,
    private readonly getTask: (taskId: Task["id"]) => Task | undefined,
    private readonly listExecutions: () => readonly { taskId: string; attempt: number }[],
    private readonly events: EventStore,
  ) {}

  dispatchReadyTasks(input: DispatchReadyTasksInput): DispatchReadyTasksResult {
    const currentTasks = input.tasks.map((task) => this.getTask(task.id) ?? task);

    validateDispatchTasks(input.mission, currentTasks);

    const dependencies: readonly TaskDependency[] = currentTasks.map((task) => ({
      id: task.id,
      status: task.status,
    }));

    const readyTaskIds = getReadyTaskIds(currentTasks);
    const currentExecutions = this.listExecutions();
    const plans: ExecutionDispatchPlan[] = [];

    for (const taskId of readyTaskIds) {
      const task = currentTasks.find((candidate) => candidate.id === taskId);

      if (task === undefined) {
        continue;
      }

      const readyTask = markTaskReady(task, dependencies, input.now);

      const attempt =
        currentExecutions
          .filter((execution) => execution.taskId === task.id)
          .reduce((maximum, execution) => Math.max(maximum, execution.attempt), 0) + 1;

      const executionId = input.identities.executionId(task.id, attempt);

      const plan = this.executionDispatch.dispatch({
        task: readyTask,
        dependencies,
        actorId: input.actorId,
        agentId: input.agentId,
        requiredCapabilityIds: input.requiredCapabilityIds,
        executionId,
        attempt,
        policy: input.policy,
        decisionId: input.identities.policyDecisionId(task.id, executionId),
        approvalRequestId: input.identities.approvalRequestId(task.id, executionId),
        requestedBy: input.requestedBy,
        requestedAt: input.now,
        evaluatedAt: input.now,
        riskLevel: input.riskLevel,
        expiresAt: input.expiresAt,
      });

      const taskStatus =
        plan.nextStep === "ENQUEUE"
          ? "APPROVED"
          : plan.nextStep === "AWAIT_APPROVAL"
            ? "APPROVAL_REQUIRED"
            : "REJECTED";

      const updatedTask = transitionTaskStatus(readyTask, taskStatus, input.now);
      this.saveTask(updatedTask);
      appendTaskStatusChangedEvent(
        this.events,
        updatedTask,
        task.status,
        updatedTask.status,
        input.actorId,
        input.now,
      );
      plans.push(plan);
    }

    return {
      dispatched: plans.filter((plan) => plan.nextStep === "ENQUEUE"),
      awaitingApproval: plans.filter((plan) => plan.nextStep === "AWAIT_APPROVAL"),
      rejected: plans.filter((plan) => plan.nextStep === "REJECTED"),
    };
  }
}
