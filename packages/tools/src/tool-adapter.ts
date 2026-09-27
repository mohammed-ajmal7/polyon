import type { ToolId } from "@polyon/contracts";

export interface ToolInvocationRequest<TInput = unknown> {
  readonly input: TInput;
}

export interface ToolInvocationResult<TOutput = unknown> {
  readonly output: TOutput;
}

export interface ToolAdapter<TInput = unknown, TOutput = unknown> {
  readonly toolId: ToolId;
  invoke(request: ToolInvocationRequest<TInput>): Promise<ToolInvocationResult<TOutput>>;
}
