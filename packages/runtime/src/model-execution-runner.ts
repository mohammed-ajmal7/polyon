import type {
  Execution,
  TextModelRequest,
} from "@polyon/contracts";
import {
  ModelGateway,
  type ModelInvocationOptions,
} from "@polyon/providers";
import type { TaskStore } from "@polyon/storage";

import type {
  ExecutionRunContext,
  ExecutionRunResult,
  ExecutionRunner,
} from "./execution-runner";

export interface ModelExecutionRunnerDependencies {
  readonly modelGateway: ModelGateway;
  readonly tasks: TaskStore;
  readonly modelOptions?: ModelInvocationOptions;
  readonly systemPrompt?: string;
}

export class ModelExecutionRunner implements ExecutionRunner {
  constructor(private readonly dependencies: ModelExecutionRunnerDependencies) {}

  async run(
    execution: Execution,
    context?: ExecutionRunContext,
  ): Promise<ExecutionRunResult> {
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
      const modelOptions: ModelInvocationOptions = {
        ...this.dependencies.modelOptions,
        ...(context === undefined ? {} : { signal: context.signal }),
      };
      const result = await this.dependencies.modelGateway.invokeText(
        execution.modelId,
        {
          messages,
        },
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
