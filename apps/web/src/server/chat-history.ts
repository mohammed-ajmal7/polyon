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
    p_payload: await sealPayload(history),
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
  return await openPayload(row.payload);
}

export async function listDurableConversationHistory(limit = 50): Promise<readonly ChatHistoryConversation[]> {
  const rows = await callChatHistory("polyon_chat_history_list", { p_limit: limit });
  if (!Array.isArray(rows)) return [];
  const decoded = await Promise.all(
    rows.map((row) =>
      isRecord(row) && typeof row.payload === "string" ? openPayload(row.payload) : Promise.resolve(undefined),
    ),
  );
  return decoded
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

async function sealPayload(value: unknown): Promise<string> {
  const secret = process.env.POLYON_API_TOKEN?.trim();
  if (secret === undefined || secret === "") {
    return "plain." + encodeBase64Url(JSON.stringify(value));
  }

  const iv = cryptoRandomBytes(12);
  const key = await deriveKey(secret);
  const ciphertext = new Uint8Array(
    await globalThis.crypto.subtle.encrypt(
      { name: "AES-GCM", iv, tagLength: 128 },
      key,
      new TextEncoder().encode(JSON.stringify(value)),
    ),
  );

  return ["v1", encodeBase64Url(iv), encodeBase64Url(ciphertext)].join(".");
}

async function openPayload(value: string): Promise<ChatHistoryConversation | undefined> {
  try {
    if (value.startsWith("plain.")) {
      return JSON.parse(decodeBase64Url(value.slice(6))) as ChatHistoryConversation;
    }

    const secret = process.env.POLYON_API_TOKEN?.trim();
    if (secret === undefined || secret === "") return undefined;

    const [version, ivText, ciphertextText] = value.split(".");
    if (version !== "v1" || ivText === undefined || ciphertextText === undefined) return undefined;

    const key = await deriveKey(secret);
    const plaintext = await globalThis.crypto.subtle.decrypt(
      { name: "AES-GCM", iv: decodeBase64Url(ivText), tagLength: 128 },
      key,
      decodeBase64Url(ciphertextText),
    );

    return JSON.parse(new TextDecoder().decode(plaintext)) as ChatHistoryConversation;
  } catch {
    return undefined;
  }
}

async function deriveKey(secret: string): Promise<CryptoKey> {
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(secret),
  );
  return globalThis.crypto.subtle.importKey(
    "raw",
    digest,
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"],
  );
}

function cryptoRandomBytes(size: number): Uint8Array {
  const bytes = new Uint8Array(size);
  globalThis.crypto.getRandomValues(bytes);
  return bytes;
}

function encodeBase64Url(bytes: Uint8Array | string): string {
  const input = typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes;
  return Buffer.from(input).toString("base64url");
}

function decodeBase64Url(value: string): Uint8Array {
  return new Uint8Array(Buffer.from(value, "base64url"));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
