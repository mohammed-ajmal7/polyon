import type {
  Execution,
  TextModelRequest,
} from "@polyon/contracts";
import {
  ModelGateway,
  type ModelInvocationOptions,
} from "@polyon/providers";
import type { TaskStore } from "@polyon/storage";

import type { ExecutionRunner, ExecutionRunResult } from "./execution-runner";

export interface ModelExecutionRunnerDependencies {
  readonly modelGateway: ModelGateway;
  readonly tasks: TaskStore;
  readonly modelOptions?: ModelInvocationOptions;
  readonly systemPrompt?: string;
}

export class ModelExecutionRunner implements ExecutionRunner {
  constructor(private readonly dependencies: ModelExecutionRunnerDependencies) {}

  async run(execution: Execution): Promise<ExecutionRunResult> {
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
      const result = await this.dependencies.modelGateway.invokeText(
        execution.modelId,
        {
          messages,
        },
        this.dependencies.modelOptions,
      );

      return {
        status: "SUCCEEDED",
        output: result.output.content,
      };
    } catch (error) {
      return {
        status: "FAILED",
        error: error instanceof Error ? error.message : "Model execution failed.",
      };
    }
  }
}
