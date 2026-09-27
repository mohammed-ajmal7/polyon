import type {
  ActionKind,
  ActorId,
  CapabilityId,
  ModelMessage,
  ModelToolCall,
  ModelToolDefinition,
  Policy,
  RiskLevel,
  TextModelRequest,
  TextModelResponse,
  Tool,
} from "@polyon/contracts";
import type { AgentGateway } from "@polyon/agents";
import { transitionExecutionStatus, transitionTaskStatus } from "@polyon/core";
import type { ApprovalRequestStore, ExecutionStore, EventStore, TaskStore, DomainUnitOfWork } from "@polyon/storage";

import type { ToolInvocationOutcome, ToolInvocationService } from "./tool-invocation-service";

export interface AgentToolOrchestrationInput {
  readonly agentId: string;
  readonly requiredCapabilityIds: readonly CapabilityId[];
  readonly request: TextModelRequest;
  readonly policy: Policy;
  readonly actorId: ActorId;
  readonly missionId?: string;
  readonly taskId?: string;
  readonly executionId?: string;
  readonly maxToolRounds?: number;
  readonly defaultRiskLevel?: RiskLevel;
  readonly now?: () => string;
}

export type AgentToolOrchestrationResult =
  | {
      readonly status: "SUCCEEDED";
      readonly response: TextModelResponse;
      readonly rounds: number;
    }
  | {
      readonly status: "APPROVAL_REQUIRED";
      readonly response: TextModelResponse;
      readonly approval: Extract<ToolInvocationOutcome, { status: "APPROVAL_REQUIRED" }>["approvalRequest"];
      readonly rounds: number;
    }
  | {
      readonly status: "REJECTED" | "FAILED";
      readonly response: TextModelResponse;
      readonly error: string;
      readonly rounds: number;
    };

export interface AgentToolOrchestrationDependencies {
  readonly agentGateway: AgentGateway;
  readonly toolInvocation: ToolInvocationService;
  readonly tools: { get(toolId: string): Tool | undefined; list(): readonly Tool[] };
  readonly approvals: ApprovalRequestStore;
  readonly executions: ExecutionStore;
  readonly tasks: TaskStore;
  readonly events: EventStore;
  readonly unitOfWork?: DomainUnitOfWork;
  readonly enqueueExecution: (execution: import("@polyon/contracts").Execution) => void;
}

export class AgentToolOrchestrationService {
  constructor(private readonly dependencies: AgentToolOrchestrationDependencies) {}

  async invoke(input: AgentToolOrchestrationInput): Promise<AgentToolOrchestrationResult> {
    const initial = await this.dependencies.agentGateway.invokeText({
      agentId: input.agentId,
      requiredCapabilityIds: input.requiredCapabilityIds,
      request: this.withToolDefinitions(input.request),
    });

    return this.continueFromResponse(
      input,
      this.withToolDefinitions(input.request),
      initial.output,
    );
  }

  async continueFromResponse(
    input: AgentToolOrchestrationInput,
    request: TextModelRequest,
    response: TextModelResponse,
  ): Promise<AgentToolOrchestrationResult> {
    const maxRounds = input.maxToolRounds ?? 8;
    if (!Number.isInteger(maxRounds) || maxRounds <= 0) {
      throw new RangeError("maxToolRounds must be a positive integer.");
    }

    let currentRequest = this.withToolDefinitions(request);
    let currentResponse = response;
    let rounds = 0;

    while (currentResponse.toolCalls !== undefined && currentResponse.toolCalls.length > 0) {
      rounds += 1;
      if (rounds > maxRounds) {
        return {
          status: "FAILED",
          response: currentResponse,
          error: `Tool-call round limit exceeded: ${maxRounds}.`,
          rounds,
        };
      }

      const assistantMessage: ModelMessage = {
        role: "ASSISTANT",
        content: currentResponse.content,
        toolCalls: currentResponse.toolCalls,
      };

      const toolMessages: ModelMessage[] = [];
      for (const toolCall of currentResponse.toolCalls) {
        const outcome = await this.invokeTool(input, toolCall);

        if (outcome.status === "APPROVAL_REQUIRED") {
          return {
            status: "APPROVAL_REQUIRED",
            response: currentResponse,
            approval: outcome.approvalRequest,
            rounds,
          };
        }

        if (outcome.status === "REJECTED" || outcome.status === "FAILED") {
          return {
            status: outcome.status,
            response: currentResponse,
            error: outcome.error,
            rounds,
          };
        }

        toolMessages.push({
          role: "TOOL",
          name: toolCall.toolId,
          toolCallId: toolCall.id,
          content: stringifyToolOutput(outcome.output),
        });
      }

      currentRequest = {
        ...currentRequest,
        messages: [...currentRequest.messages, assistantMessage, ...toolMessages],
      };

      const next = await this.dependencies.agentGateway.invokeText({
        agentId: input.agentId,
        requiredCapabilityIds: input.requiredCapabilityIds,
        request: currentRequest,
      });
      currentResponse = next.output;
    }

    return {
      status: "SUCCEEDED",
      response: currentResponse,
      rounds,
    };
  }

  private withToolDefinitions(request: TextModelRequest): TextModelRequest {
    if (request.tools !== undefined) {
      return request;
    }

    const tools: ModelToolDefinition[] = this.dependencies.tools
      .list()
      .filter((tool) => tool.enabled)
      .map((tool) => ({
        toolId: tool.id,
        name: tool.id,
        description: tool.description,
      }));

    return tools.length === 0 ? request : { ...request, tools };
  }

  private async invokeTool(
    input: AgentToolOrchestrationInput,
    toolCall: ModelToolCall,
    continuation: {
      readonly request: TextModelRequest;
      readonly response: TextModelResponse;
      readonly rounds: number;
    },
  ): Promise<ToolInvocationOutcome> {
    const tool = this.dependencies.tools.get(toolCall.toolId);
    if (tool === undefined) {
      return {
        status: "REJECTED",
        invocationId: `tool-call:${toolCall.id}`,
        toolId: toolCall.toolId,
        policyDecision: {
          id: `policy-decision:tool-call:${toolCall.id}`,
          policyId: input.policy.id,
          action: "READ",
          riskLevel: input.defaultRiskLevel ?? "LOW",
          effect: "DENY",
          reason: `Unknown tool requested by model: ${toolCall.toolId}.`,
          evaluatedAt: this.now(input),
        },
        error: `Tool not found: ${toolCall.toolId}.`,
      };
    }

    const action = selectAction(tool);
    const riskLevel = input.defaultRiskLevel ?? defaultRiskForAction(action);

    return this.dependencies.toolInvocation.invoke({
      invocationId: `tool-call:${toolCall.id}`,
      toolId: tool.id,
      input: toolCall.input,
      action,
      riskLevel,
      policy: input.policy,
      decisionId: `policy-decision:tool-call:${toolCall.id}`,
      approvalRequestId: `approval:tool-call:${toolCall.id}`,
      requestedBy: input.actorId,
      requestedAt: this.now(input),
      evaluatedAt: this.now(input),
      actorId: input.actorId,
      ...(input.missionId === undefined ? {} : { missionId: input.missionId }),
      ...(input.taskId === undefined ? {} : { taskId: input.taskId }),
      ...(input.executionId === undefined ? {} : { executionId: input.executionId }),
      agentId: input.agentId,
      toolContinuation: {
        agentId: input.agentId,
        requiredCapabilityIds: input.requiredCapabilityIds,
        request: continuation.request,
        response: continuation.response,
        toolCall,
        rounds: continuation.rounds,
      },
    });
  }

  private now(input: AgentToolOrchestrationInput): string {
    return (input.now ?? (() => new Date().toISOString()))();
  }

  private async pauseExecutionForApproval(
    executionId: string | undefined,
    approvalId: string,
  ): Promise<void> {
    if (executionId === undefined) return;
    const execution = this.dependencies.executions.get(executionId);
    if (execution === undefined || execution.status !== "RUNNING") return;
    const task = this.dependencies.tasks.get(execution.taskId);
    if (task === undefined) throw new Error(`Task not found for execution ${executionId}.`);

    const now = new Date().toISOString();
    const operation = (stores: {
      executions: ExecutionStore;
      tasks: TaskStore;
      events: EventStore;
    }) => {
      const pausedExecution = transitionExecutionStatus(execution, "PAUSED", now);
      const pausedTask = transitionTaskStatus(task, "PAUSED", now);
      stores.executions.save(pausedExecution);
      stores.tasks.save(pausedTask);
      stores.events.append({
        id: `EXECUTION_STATUS_CHANGED:${execution.id}:RUNNING:PAUSED:${now}:TOOL_APPROVAL`,
        kind: "EXECUTION_STATUS_CHANGED",
        actorId: execution.actorId,
        missionId: execution.missionId,
        taskId: execution.taskId,
        executionId: execution.id,
        occurredAt: now,
        data: { from: "RUNNING", to: "PAUSED", reason: "TOOL_APPROVAL", approvalRequestId: approvalId },
      });
      stores.events.append({
        id: `TASK_STATUS_CHANGED:${task.id}:RUNNING:PAUSED:${now}:TOOL_APPROVAL`,
        kind: "TASK_STATUS_CHANGED",
        missionId: task.missionId,
        taskId: task.id,
        occurredAt: now,
        data: { from: "RUNNING", to: "PAUSED", reason: "TOOL_APPROVAL", approvalRequestId: approvalId },
      });
    };
    if (this.dependencies.unitOfWork === undefined) operation(this.dependencies);
    else this.dependencies.unitOfWork.transaction(operation);
  }

  resolveToolApproval(input: {
    readonly approvalId: string;
    readonly status: "APPROVED" | "REJECTED" | "EXPIRED" | "CANCELLED";
    readonly resolvedAt: string;
    readonly resolvedBy?: ActorId;
  }): { readonly status: "ENQUEUED" | "REJECTED" | "CANCELLED"; readonly executionId?: string } {
    const approval = this.dependencies.toolInvocation.resolveApproval(input);
    if (approval.status !== "APPROVED") {
      const executionId = approval.executionId;
      if (executionId !== undefined) {
        const execution = this.dependencies.executions.get(executionId);
        const task = execution === undefined ? undefined : this.dependencies.tasks.get(execution.taskId);
        if (execution !== undefined && task !== undefined) {
          const target = input.status === "CANCELLED" ? "CANCELLED" : "REJECTED";
          const updatedExecution = transitionExecutionStatus(execution, target, input.resolvedAt);
          const updatedTask = transitionTaskStatus(task, target, input.resolvedAt);
          this.dependencies.executions.save(updatedExecution);
          this.dependencies.tasks.save(updatedTask);
        }
      }
      return { status: input.status === "CANCELLED" ? "CANCELLED" : "REJECTED", ...(executionId === undefined ? {} : { executionId }) };
    }

    if (approval.executionId === undefined) {
      throw new Error(`Approved tool approval ${approval.id} has no execution binding.`);
    }
    const execution = this.dependencies.executions.get(approval.executionId);
    if (execution === undefined || execution.status !== "PAUSED") {
      throw new Error(`Execution ${approval.executionId} is not paused for tool approval.`);
    }
    const task = this.dependencies.tasks.get(execution.taskId);
    if (task === undefined || task.status !== "PAUSED") {
      throw new Error(`Task ${execution.taskId} is not paused for tool approval.`);
    }

    const queuedExecution = transitionExecutionStatus(execution, "QUEUED", input.resolvedAt);
    const queuedTask = transitionTaskStatus(task, "RUNNING", input.resolvedAt);
    const operation = (stores: {
      executions: ExecutionStore;
      tasks: TaskStore;
      events: EventStore;
    }) => {
      stores.executions.save(queuedExecution);
      stores.tasks.save(queuedTask);
      stores.events.append({
        id: `EXECUTION_STATUS_CHANGED:${execution.id}:PAUSED:QUEUED:${input.resolvedAt}:TOOL_APPROVAL`,
        kind: "EXECUTION_STATUS_CHANGED",
        actorId: execution.actorId,
        missionId: execution.missionId,
        taskId: execution.taskId,
        executionId: execution.id,
        occurredAt: input.resolvedAt,
        data: { from: "PAUSED", to: "QUEUED", reason: "TOOL_APPROVAL", approvalRequestId: approval.id },
      });
      stores.events.append({
        id: `TASK_STATUS_CHANGED:${task.id}:PAUSED:RUNNING:${input.resolvedAt}:TOOL_APPROVAL`,
        kind: "TASK_STATUS_CHANGED",
        missionId: task.missionId,
        taskId: task.id,
        occurredAt: input.resolvedAt,
        data: { from: "PAUSED", to: "RUNNING", reason: "TOOL_APPROVAL", approvalRequestId: approval.id },
      });
    };
    if (this.dependencies.unitOfWork === undefined) operation(this.dependencies);
    else this.dependencies.unitOfWork.transaction(operation);
    this.dependencies.enqueueExecution(queuedExecution);
    return { status: "ENQUEUED", executionId: queuedExecution.id };
  }

  async resumeApprovedExecution(
    executionId: string,
    policy: Policy,
  ): Promise<AgentToolOrchestrationResult> {
    const approval = this.dependencies.approvals
      .list()
      .find((candidate) => candidate.executionId === executionId && candidate.status === "APPROVED" && candidate.toolContinuation !== undefined);

    if (approval === undefined || approval.toolContinuation === undefined) {
      throw new Error(`No approved tool continuation exists for execution ${executionId}.`);
    }

    const continuation = approval.toolContinuation;
    const outcome = await this.dependencies.toolInvocation.invokeApproved({
      invocationId: continuation.toolCall.id.startsWith("tool-call:")
        ? continuation.toolCall.id
        : `tool-call:${continuation.toolCall.id}`,
      approvalId: approval.id,
      toolId: continuation.toolCall.toolId,
      input: continuation.toolCall.input,
    });

    if (outcome.status !== "SUCCEEDED") {
      return {
        status: outcome.status,
        response: continuation.response,
        error: outcome.status === "APPROVAL_REQUIRED" ? "Tool approval unexpectedly remained required." : outcome.error,
        ...(outcome.status === "APPROVAL_REQUIRED" ? { approval: outcome.approvalRequest } : {}),
        rounds: continuation.rounds,
      } as AgentToolOrchestrationResult;
    }

    const toolMessage: ModelMessage = {
      role: "TOOL",
      name: continuation.toolCall.toolId,
      toolCallId: continuation.toolCall.id,
      content: stringifyToolOutput(outcome.output),
    };

    const request: TextModelRequest = {
      ...continuation.request,
      messages: [
        ...continuation.request.messages,
        {
          role: "ASSISTANT",
          content: continuation.response.content,
          toolCalls: continuation.response.toolCalls,
        },
        toolMessage,
      ],
    };

    const next = await this.dependencies.agentGateway.invokeText({
      agentId: continuation.agentId,
      requiredCapabilityIds: continuation.requiredCapabilityIds,
      request: this.withToolDefinitions(request),
    });

    return this.continueFromResponse(
      {
        agentId: continuation.agentId,
        requiredCapabilityIds: continuation.requiredCapabilityIds,
        request,
        policy,
        actorId: approval.requestedBy,
        missionId: approval.missionId,
        taskId: approval.taskId,
        executionId,
        maxToolRounds: 8,
      },
      request,
      next.output,
    );
  }
}

function selectAction(tool: Tool): ActionKind {
  const action = tool.actionKinds[0];
  if (action === undefined) {
    throw new Error(`Tool ${tool.id} does not declare an action kind.`);
  }
  return action;
}

function defaultRiskForAction(action: ActionKind): RiskLevel {
  switch (action) {
    case "DELETE":
      return "HIGH";
    case "WRITE":
    case "EXTERNAL_COMMUNICATION":
      return "MEDIUM";
    default:
      return "LOW";
  }
}

function stringifyToolOutput(output: unknown): string {
  if (typeof output === "string") {
    return output;
  }

  try {
    return JSON.stringify(output);
  } catch {
    return String(output);
  }
}

  
  private async pauseExecutionForApproval(
    executionId: string | undefined,
    approvalId: string,
  ): Promise<void> {
    if (executionId === undefined) return;
    const execution = this.dependencies.executions.get(executionId);
    if (execution === undefined || execution.status !== "RUNNING") return;
    const task = this.dependencies.tasks.get(execution.taskId);
    if (task === undefined) throw new Error(`Task not found for execution ${executionId}.`);

    const now = new Date().toISOString();
    const operation = (stores: {
      executions: ExecutionStore;
      tasks: TaskStore;
      events: EventStore;
    }) => {
      const pausedExecution = transitionExecutionStatus(execution, "PAUSED", now);
      const pausedTask = transitionTaskStatus(task, "PAUSED", now);
      stores.executions.save(pausedExecution);
      stores.tasks.save(pausedTask);
      stores.events.append({
        id: `EXECUTION_STATUS_CHANGED:${execution.id}:RUNNING:PAUSED:${now}:TOOL_APPROVAL`,
        kind: "EXECUTION_STATUS_CHANGED",
        actorId: execution.actorId,
        missionId: execution.missionId,
        taskId: execution.taskId,
        executionId: execution.id,
        occurredAt: now,
        data: { from: "RUNNING", to: "PAUSED", reason: "TOOL_APPROVAL", approvalRequestId: approvalId },
      });
      stores.events.append({
        id: `TASK_STATUS_CHANGED:${task.id}:RUNNING:PAUSED:${now}:TOOL_APPROVAL`,
        kind: "TASK_STATUS_CHANGED",
        missionId: task.missionId,
        taskId: task.id,
        occurredAt: now,
        data: { from: "RUNNING", to: "PAUSED", reason: "TOOL_APPROVAL", approvalRequestId: approvalId },
      });
    };
    if (this.dependencies.unitOfWork === undefined) {
      operation(this.dependencies);
    } else {
      this.dependencies.unitOfWork.transaction(operation);
    }
  }
