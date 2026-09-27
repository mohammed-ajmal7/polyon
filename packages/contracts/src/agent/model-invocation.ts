export type ModelMessageRole = "SYSTEM" | "USER" | "ASSISTANT" | "TOOL";

export interface ModelToolCall {
  readonly id: string;
  readonly toolId: string;
  readonly input: unknown;
}

export interface ModelToolDefinition {
  readonly toolId: string;
  readonly name: string;
  readonly description: string;
  readonly inputSchema?: unknown;
}

export interface ModelMessage {
  readonly role: ModelMessageRole;
  readonly content: string;
  readonly name?: string;
  readonly toolCallId?: string;
}

export interface TextModelRequest {
  readonly messages: readonly ModelMessage[];
  readonly tools?: readonly ModelToolDefinition[];
  readonly temperature?: number;
  readonly maxOutputTokens?: number;
}

export type TextModelFinishReason = "STOP" | "LENGTH" | "TOOL_CALL" | "OTHER";

export interface TextModelUsage {
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly totalTokens?: number;
}

export interface TextModelResponse {
  readonly content: string;
  readonly finishReason?: TextModelFinishReason;
  readonly toolCalls?: readonly ModelToolCall[];
  readonly usage?: TextModelUsage;
}
