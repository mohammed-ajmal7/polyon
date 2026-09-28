import type { ActorId, AgentId, ArtifactKind, ArtifactStatus, ToolId } from "@polyon/contracts";

export interface ToolInvocationContext {
  readonly actorId?: ActorId;
  readonly agentId?: AgentId;
  readonly missionId?: string;
  readonly taskId?: string;
  readonly executionId?: string;
}

export interface ToolInvocationRequest<TInput = unknown> {
  readonly input: TInput;
  readonly context?: ToolInvocationContext;
}

export interface ToolArtifactResult {
  readonly id: string;
  readonly kind: ArtifactKind;
  readonly name: string;
  readonly mimeType?: string;
  readonly location: string;
  readonly status: ArtifactStatus;
}

export interface ToolInvocationResult<TOutput = unknown> {
  readonly output: TOutput;
  readonly artifacts?: readonly ToolArtifactResult[];
}

export interface ToolAdapter<TInput = unknown, TOutput = unknown> {
  readonly toolId: ToolId;
  invoke(request: ToolInvocationRequest<TInput>): Promise<ToolInvocationResult<TOutput>>;
}
