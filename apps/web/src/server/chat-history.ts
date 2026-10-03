import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

import type { Message } from "@polyon/contracts";

import { getPolyonComposition } from "@/server/polyon-server";

const SUPABASE_URL =
  process.env.POLYON_RUN_STATE_SUPABASE_URL?.trim() ||
  "https://kputedwmsvqdgfmkjkzq.supabase.co";
const SUPABASE_KEY =
  process.env.POLYON_RUN_STATE_SUPABASE_KEY?.trim() ||
  "sb_publishable_kJJa6i4NJlxP42ceGaGLog_7BebV3Ca";

export interface ChatHistoryMessage {
  readonly id: string;
  readonly conversationId: string;
  readonly actorId: string;
  readonly role: Message["role"];
  readonly kind: Message["kind"];
  readonly content: string;
  readonly runId?: string;
  readonly fromAgentId?: string;
  readonly toAgentId?: string;
  readonly agentMessageType?: Message["agentMessageType"];
  readonly createdAt: string;
}

export interface ChatHistoryConversation {
  readonly id: string;
  readonly kind: string;
  readonly status: string;
  readonly participantIds: readonly string[];
  readonly missionId?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly messages: readonly ChatHistoryMessage[];
}

export async function persistConversationHistory(conversationId: string): Promise<void> {
  if (process.env.VERCEL !== "1") return;

  const stores = getPolyonComposition().stores;
  const conversation = stores.conversations.get(conversationId);
  if (conversation === undefined) return;

  const messages = conversation.messageIds
    .map((messageId) => stores.messages.get(messageId))
    .filter((message): message is Message => message !== undefined)
    .map(toHistoryMessage);

  const history: ChatHistoryConversation = {
    id: conversation.id,
    kind: conversation.kind,
    status: conversation.status,
    participantIds: conversation.participantIds,
    ...(conversation.missionId === undefined ? {} : { missionId: conversation.missionId }),
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
    messages,
  };

  await callChatHistory("polyon_chat_history_upsert", {
    p_conversation_id: conversation.id,
    p_payload: sealPayload(history),
    p_created_at: conversation.createdAt,
    p_updated_at: conversation.updatedAt,
  });
}

export async function getDurableConversationHistory(
  conversationId: string,
): Promise<ChatHistoryConversation | undefined> {
  const rows = await callChatHistory("polyon_chat_history_get", { p_conversation_id: conversationId });
  const row = Array.isArray(rows) ? rows[0] : undefined;
  if (!isRecord(row) || typeof row.payload !== "string") return undefined;
  return openPayload(row.payload);
}

export async function listDurableConversationHistory(limit = 50): Promise<readonly ChatHistoryConversation[]> {
  const rows = await callChatHistory("polyon_chat_history_list", { p_limit: limit });
  if (!Array.isArray(rows)) return [];
  return rows
    .map((row) => (isRecord(row) && typeof row.payload === "string" ? openPayload(row.payload) : undefined))
    .filter((value): value is ChatHistoryConversation => value !== undefined)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

function toHistoryMessage(message: Message): ChatHistoryMessage {
  return {
    id: message.id,
    conversationId: message.conversationId,
    actorId: message.actorId,
    role: message.role,
    kind: message.kind,
    content: message.content,
    ...(message.runId === undefined ? {} : { runId: message.runId }),
    ...(message.fromAgentId === undefined ? {} : { fromAgentId: message.fromAgentId }),
    ...(message.toAgentId === undefined ? {} : { toAgentId: message.toAgentId }),
    ...(message.agentMessageType === undefined ? {} : { agentMessageType: message.agentMessageType }),
    createdAt: message.createdAt,
  };
}

async function callChatHistory(
  functionName: "polyon_chat_history_upsert" | "polyon_chat_history_get" | "polyon_chat_history_list",
  body: Record<string, unknown>,
): Promise<unknown> {
  const response = await fetch(SUPABASE_URL + "/rest/v1/rpc/" + functionName, {
    method: "POST",
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: "Bearer " + SUPABASE_KEY,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  if (!response.ok) {
    const message = await response.text().catch(() => "");
    throw new Error(
      "Durable chat history unavailable (" + response.status + ")" +
        (message === "" ? "." : ": " + message.slice(0, 300)),
    );
  }
  return (await response.json()) as unknown;
}

function sealPayload(value: unknown): string {
  const secret = process.env.POLYON_API_TOKEN?.trim();
  if (secret === undefined || secret === "") {
    return "plain." + Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
  }
  const iv = randomBytes(12);
  const key = Buffer.from(createHash("sha256").update(secret).digest("hex"), "hex");
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v1", iv.toString("base64url"), tag.toString("base64url"), ciphertext.toString("base64url")].join(".");
}

function openPayload(value: string): ChatHistoryConversation | undefined {
  try {
    if (value.startsWith("plain.")) {
      return JSON.parse(Buffer.from(value.slice(6), "base64url").toString("utf8")) as ChatHistoryConversation;
    }
    const secret = process.env.POLYON_API_TOKEN?.trim();
    if (secret === undefined || secret === "") return undefined;
    const [version, ivText, tagText, ciphertextText] = value.split(".");
    if (version !== "v1" || ivText === undefined || tagText === undefined || ciphertextText === undefined) return undefined;
    const key = Buffer.from(createHash("sha256").update(secret).digest("hex"), "hex");
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivText, "base64url"));
    decipher.setAuthTag(Buffer.from(tagText, "base64url"));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(ciphertextText, "base64url")),
      decipher.final(),
    ]).toString("utf8");
    return JSON.parse(plaintext) as ChatHistoryConversation;
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
