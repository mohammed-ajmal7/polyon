import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

export type ChatMessageRole = "user" | "assistant";

export interface ChatMessage {
  readonly id: string;
  readonly role: ChatMessageRole;
  readonly content: string;
  readonly createdAt: string;
  readonly mode?: string;
  readonly result?: unknown;
}

export interface ChatConversation {
  readonly conversationId: string;
  readonly title: string;
  readonly messages: readonly ChatMessage[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

const SUPABASE_URL =
  process.env.POLYON_RUN_STATE_SUPABASE_URL?.trim() ||
  "https://kputedwmsvqdgfmkjkzq.supabase.co";
const SUPABASE_KEY =
  process.env.POLYON_RUN_STATE_SUPABASE_KEY?.trim() ||
  "sb_publishable_kJJa6i4NJlxP42ceGaGLog_7BebV3Ca";

export async function appendChatMessage(input: {
  readonly conversationId: string;
  readonly message: ChatMessage;
}): Promise<ChatConversation> {
  const existing = await getChatConversation(input.conversationId);
  const now = input.message.createdAt;
  const messages = [...(existing?.messages ?? []), input.message];
  const title =
    existing?.title ??
    (input.message.role === "user" ? makeChatTitle(input.message.content) : "New chat");
  const conversation: ChatConversation = {
    conversationId: input.conversationId,
    title,
    messages,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  await upsertChatConversation(conversation);
  return conversation;
}

export async function getChatConversation(
  conversationId: string,
): Promise<ChatConversation | undefined> {
  const rows = await callRpc("polyon_chat_conversation_get", {
    p_conversation_id: conversationId,
  });
  const row = Array.isArray(rows) ? rows[0] : undefined;
  return parseRow(row);
}

export async function listChatConversations(limit = 50): Promise<ChatConversation[]> {
  const rows = await callRpc("polyon_chat_conversation_list", { p_limit: limit });
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((row) => {
    const parsed = parseRow(row);
    return parsed === undefined ? [] : [parsed];
  });
}

async function upsertChatConversation(conversation: ChatConversation): Promise<void> {
  await callRpc("polyon_chat_conversation_upsert", {
    p_conversation_id: conversation.conversationId,
    p_payload: sealPayload(conversation),
    p_created_at: conversation.createdAt,
    p_updated_at: conversation.updatedAt,
  });
}

function parseRow(value: unknown): ChatConversation | undefined {
  if (!isRecord(value) || typeof value.payload !== "string") return undefined;
  const payload = openPayload(value.payload);
  if (!isRecord(payload)) return undefined;
  if (
    typeof payload.conversationId !== "string" ||
    typeof payload.title !== "string" ||
    !Array.isArray(payload.messages) ||
    typeof value.created_at !== "string" ||
    typeof value.updated_at !== "string"
  ) {
    return undefined;
  }

  const messages = payload.messages.flatMap((message) => {
    if (!isRecord(message)) return [];
    if (
      typeof message.id !== "string" ||
      (message.role !== "user" && message.role !== "assistant") ||
      typeof message.content !== "string" ||
      typeof message.createdAt !== "string"
    ) {
      return [];
    }
    return [{
      id: message.id,
      role: message.role,
      content: message.content,
      createdAt: message.createdAt,
      ...(typeof message.mode === "string" ? { mode: message.mode } : {}),
      ...(message.result === undefined ? {} : { result: message.result }),
    } satisfies ChatMessage];
  });

  return {
    conversationId: payload.conversationId,
    title: payload.title,
    messages,
    createdAt: value.created_at,
    updatedAt: value.updated_at,
  };
}

async function callRpc(functionName: string, body: Record<string, unknown>): Promise<unknown> {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${functionName}`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  if (!response.ok) {
    const message = await response.text().catch(() => "");
    throw new Error(
      `Durable chat history unavailable (${response.status})${message === "" ? "." : `: ${message.slice(0, 300)}`}`,
    );
  }

  // The upsert RPC returns void (204 No Content). Do not call response.json()
  // on an empty response body; GET/LIST RPCs still return JSON below.
  const body = await response.text();
  if (body.trim() === "") return undefined;
  try {
    return JSON.parse(body) as unknown;
  } catch {
    throw new Error("Durable chat history returned invalid JSON.");
  }
}

export function makeChatTitle(input: string): string {
  const clean = input.replace(/\\s+/g, " ").trim();
  if (clean === "") return "New chat";
  if (clean.length <= 56) return clean;
  const clipped = clean.slice(0, 56);
  const lastSpace = clipped.lastIndexOf(" ");
  return (lastSpace >= 28 ? clipped.slice(0, lastSpace) : clipped).trimEnd() + "…";
}

function sealPayload(value: unknown): string {
  const secret = process.env.POLYON_API_TOKEN?.trim();
  if (secret === undefined || secret === "") {
    return `plain.${Buffer.from(JSON.stringify(value), "utf8").toString("base64url")}`;
  }
  const iv = randomBytes(12);
  const key = Buffer.from(createHash("sha256").update(secret).digest("hex"), "hex");
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v1", iv.toString("base64url"), tag.toString("base64url"), ciphertext.toString("base64url")].join(".");
}

function openPayload(value: string): unknown | undefined {
  try {
    if (value.startsWith("plain.")) {
      return JSON.parse(Buffer.from(value.slice("plain.".length), "base64url").toString("utf8")) as unknown;
    }
    const secret = process.env.POLYON_API_TOKEN?.trim();
    if (secret === undefined || secret === "") return undefined;
    const [version, ivText, tagText, ciphertextText] = value.split(".");
    if (version !== "v1" || ivText === undefined || tagText === undefined || ciphertextText === undefined) return undefined;
    const key = Buffer.from(createHash("sha256").update(secret).digest("hex"), "hex");
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivText, "base64url"));
    decipher.setAuthTag(Buffer.from(tagText, "base64url"));
    return JSON.parse(Buffer.concat([
      decipher.update(Buffer.from(ciphertextText, "base64url")),
      decipher.final(),
    ]).toString("utf8")) as unknown;
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
