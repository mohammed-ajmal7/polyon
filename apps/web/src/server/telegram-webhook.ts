import type { Policy } from "@polyon/contracts";

export interface TelegramInboundCommand {
  readonly updateId: number;
  readonly chatId: number;
  readonly userId: number;
  readonly text: string;
}

export function parseTelegramInboundCommand(value: unknown): TelegramInboundCommand | undefined {
  if (value === null || typeof value !== "object") return undefined;
  const update = value as Record<string, unknown>;
  const updateId = update.update_id;
  const message = update.message;
  if (!Number.isSafeInteger(updateId) || message === null || typeof message !== "object") return undefined;

  const messageValue = message as Record<string, unknown>;
  const chat = messageValue.chat;
  const from = messageValue.from;
  const text = messageValue.text;
  if (chat === null || typeof chat !== "object" || from === null || typeof from !== "object") return undefined;

  const chatValue = chat as Record<string, unknown>;
  const fromValue = from as Record<string, unknown>;
  if (
    chatValue.type !== "private" ||
    !Number.isSafeInteger(chatValue.id) ||
    !Number.isSafeInteger(fromValue.id) ||
    fromValue.id !== chatValue.id ||
    typeof text !== "string" ||
    text.trim() === "" ||
    Array.from(text).length > 50_000
  ) return undefined;

  return {
    updateId: updateId as number,
    chatId: chatValue.id as number,
    userId: fromValue.id as number,
    text: text.trim(),
  };
}

export function parseTelegramAllowedChatIds(value: string | undefined): readonly number[] {
  if (value === undefined || value.trim() === "") return [];
  const ids = value.split(",").map((item) => item.trim()).filter(Boolean).map(Number);
  if (ids.some((id) => !Number.isSafeInteger(id))) {
    throw new Error("POLYON_TELEGRAM_ALLOWED_CHAT_IDS must contain safe integer chat IDs.");
  }
  return [...new Set(ids)];
}

export function buildTelegramReplyPolicy(now: string): Policy {
  return {
    id: "telegram-inbound-reply",
    name: "POLYON Telegram inbound reply policy",
    description: "Allows replies to an authenticated, allowlisted private Telegram chat.",
    approvalMode: "ASK_EVERYTHING",
    rules: [{
      priority: 100,
      integrationId: "telegram-primary",
      action: "EXTERNAL_COMMUNICATION",
      riskLevel: "LOW",
      effect: "ALLOW",
    }],
    defaultEffect: "REQUIRE_APPROVAL",
    enabled: true,
    createdAt: now,
    updatedAt: now,
  };
}
