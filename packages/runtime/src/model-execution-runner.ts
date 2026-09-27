import type { Execution, ModelToolDefinition, TextModelRequest } from "@polyon/contracts";
import { ModelGateway, type ModelInvocationOptions } from "@polyon/providers";
import type { TaskStore } from "@polyon/storage";

import type { ExecutionRunContext, ExecutionRunResult, ExecutionRunner } from "./execution-runner";

export interface ModelExecutionToolOrchestrator {
  continueFromResponse(input: {
    readonly execution: Execution;
    readonly request: TextModelRequest;
    readonly response: import("@polyon/contracts").TextModelResponse;
    readonly signal: AbortSignal;
  }): Promise<{
    readonly status: "SUCCEEDED" | "APPROVAL_REQUIRED" | "REJECTED" | "FAILED";
    readonly response: import("@polyon/contracts").TextModelResponse;
    readonly output?: string;
    readonly error?: string;
  }>;
}

export interface ModelExecutionRunnerDependencies {
  readonly modelGateway: ModelGateway;
  readonly tasks: TaskStore;
  readonly modelOptions?: ModelInvocationOptions;
  readonly systemPrompt?: string;
  readonly toolDefinitions?: readonly ModelToolDefinition[];
  readonly toolOrchestrator?: ModelExecutionToolOrchestrator;
  readonly resumeApprovedToolContinuation?: (executionId: string) => Promise<{
    readonly status: "NO_CONTINUATION" | "SUCCEEDED" | "FAILED" | "PAUSED" | "REJECTED";
    readonly output?: string;
    readonly error?: string;
  }>;
}

export class ModelExecutionRunner implements ExecutionRunner {
  constructor(private readonly dependencies: ModelExecutionRunnerDependencies) {}

  async run(execution: Execution, context?: ExecutionRunContext): Promise<ExecutionRunResult> {
    if (execution.modelId === undefined) {
      return {
        status: "FAILED",
        error: `Execution ${execution.id} has no bound model.`,
      };
    }

    const task = this.dependencies.tasks.get(execution.taskId);

    if (task === undefined) {
      return {
        status: "FAILED",
        error: `Task not found for execution ${execution.id}: ${execution.taskId}.`,
      };
    }

    if (this.dependencies.resumeApprovedToolContinuation !== undefined) {
      const resumed = await this.dependencies.resumeApprovedToolContinuation(execution.id);
      if (resumed.status === "NO_CONTINUATION") {
        // Normal first-run execution.
      } else if (resumed.status !== "SUCCEEDED") {
        return {
          status: resumed.status === "PAUSED" ? "PAUSED" : "FAILED",
          error: resumed.error ?? "Approved tool continuation failed.",
          ...(resumed.output === undefined ? {} : { output: resumed.output }),
        };
      } else {
        return {
          status: "SUCCEEDED",
          output: resumed.output ?? "",
        };
      }
    }

    const messages: TextModelRequest["messages"] = [
      ...(this.dependencies.systemPrompt === undefined
        ? []
        : [{ role: "SYSTEM" as const, content: this.dependencies.systemPrompt }]),
      {
        role: "USER",
        content: `Task: ${task.title}

${task.description}`,
      },
    ];

    try {
      const modelRequest: TextModelRequest = {
        messages,
        ...(this.dependencies.toolDefinitions === undefined
          ? {}
          : { tools: this.dependencies.toolDefinitions }),
      };

      const modelOptions: ModelInvocationOptions = {
        ...this.dependencies.modelOptions,
        ...(context === undefined ? {} : { signal: context.signal }),
      };
      const result = await this.dependencies.modelGateway.invokeText(
        execution.modelId,
        modelRequest,
        modelOptions,
      );

      const abortReason = context?.getAbortReason();

      if (abortReason === "CANCELLED") {
        return {
          status: "CANCELLED",
          error: "Execution was cancelled.",
        };
      }

      if (abortReason === "TIMEOUT") {
        return {
          status: "FAILED",
          error: "Execution timed out after the runtime execution deadline.",
          output: result.output.content,
        };
      }

      if (result.output.toolCalls !== undefined && result.output.toolCalls.length > 0) {
        if (this.dependencies.toolOrchestrator === undefined) {
          return {
            status: "FAILED",
            error:
              "Model requested tool execution, but governed tool orchestration is not configured.",
            output: result.output.content,
          };
        }

        const continuation = await this.dependencies.toolOrchestrator.continueFromResponse({
          execution,
          request: modelRequest,
          response: result.output,
          signal: context?.signal ?? new AbortController().signal,
        });

        if (continuation.status === "SUCCEEDED") {
          return {
            status: "SUCCEEDED",
            output: continuation.response.content,
          };
        }

        if (continuation.status === "APPROVAL_REQUIRED") {
          return {
            status: "PAUSED",
            error: "Execution paused for required tool approval.",
            output: continuation.response.content,
          };
        }

        return {
          status: "FAILED",
          error: continuation.error ?? "Governed tool orchestration failed.",
          output: continuation.response.content,
        };
      }

      return {
        status: "SUCCEEDED",
        output: result.output.content,
      };
    } catch (error) {
      const abortReason = context?.getAbortReason();

      if (abortReason === "CANCELLED") {
        return {
          status: "CANCELLED",
          error: "Execution was cancelled.",
        };
      }

      if (abortReason === "TIMEOUT") {
        return {
          status: "FAILED",
          error: "Execution timed out after the runtime execution deadline.",
        };
      }

      return {
        status: "FAILED",
        error: error instanceof Error ? error.message : "Model execution failed.",
      };
    }
  }
}
