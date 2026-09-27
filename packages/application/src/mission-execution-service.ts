import type {
  ActorId,
  AgentId,
  Mission,
  Policy,
  Task,
} from "@polyon/contracts";

import {
  getReadyTaskIds,
  markTaskReady,
  transitionTaskStatus,
  validateMissionTaskPlan,
  type TaskDependency,
} from "@polyon/core";

import type { ExecutionDispatchPlan } from "./execution-dispatch";
import { ExecutionDispatchService } from "./execution-dispatch-service";

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
  ) {}

  dispatchReadyTasks(input: DispatchReadyTasksInput): DispatchReadyTasksResult {
    const currentTasks = input.tasks.map((task) => this.getTask(task.id) ?? task);
    const validation = validateMissionTaskPlan(input.mission, currentTasks);

    if (!validation.valid) {
      throw new MissionExecutionValidationError(validation.errors);
    }

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

      this.saveTask(transitionTaskStatus(readyTask, taskStatus, input.now));
      plans.push(plan);
    }

    return {
      dispatched: plans.filter((plan) => plan.nextStep === "ENQUEUE"),
      awaitingApproval: plans.filter((plan) => plan.nextStep === "AWAIT_APPROVAL"),
      rejected: plans.filter((plan) => plan.nextStep === "REJECTED"),
    };
  }
}
