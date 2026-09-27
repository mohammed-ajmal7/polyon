export type ModelMessageRole = "SYSTEM" | "USER" | "ASSISTANT" | "TOOL";

export interface ModelMessage {
  readonly role: ModelMessageRole;
  readonly content: string;
  readonly name?: string;
}

export interface TextModelRequest {
  readonly messages: readonly ModelMessage[];
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
  readonly usage?: TextModelUsage;
}
