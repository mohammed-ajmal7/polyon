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
    });
  }

  private now(input: AgentToolOrchestrationInput): string {
    return (input.now ?? (() => new Date().toISOString()))();
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
