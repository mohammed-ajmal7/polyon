import type { AgentId } from "../agent/ids";
import type { ActorId } from "../actor/ids";
import type { ConversationId, MessageId } from "./ids";

export type MessageRole = "USER" | "AGENT" | "SYSTEM";

export type MessageKind =
  | "TEXT"
  | "APPROVAL_REQUEST"
  | "APPROVAL_RESPONSE"
  | "TOOL_CALL"
  | "TOOL_RESULT"
  | "STATUS"
  | "ERROR"
  | "OTHER";

export type AgentMessageType =
  | "finding"
  | "challenge"
  | "response"
  | "evidence"
  | "question"
  | "decision";

export interface Message {
  readonly id: MessageId;
  readonly conversationId: ConversationId;

  readonly actorId: ActorId;
  readonly role: MessageRole;
  readonly kind: MessageKind;

  readonly content: string;

  readonly runId?: string;
  readonly fromAgentId?: AgentId;
  readonly toAgentId?: AgentId;
  readonly agentMessageType?: AgentMessageType;
  readonly payload?: unknown;

  readonly createdAt: string;
}
