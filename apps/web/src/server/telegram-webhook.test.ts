import { describe, expect, it } from "vitest";

import {
  buildTelegramReplyPolicy,
  parseTelegramAllowedChatIds,
  parseTelegramInboundCommand,
} from "./telegram-webhook";

describe("Telegram webhook helpers", () => {
  it("accepts only private messages where sender and chat IDs match", () => {
    expect(parseTelegramInboundCommand({
      update_id: 42,
      message: { text: "hello POLYON", chat: { id: 12345, type: "private" }, from: { id: 12345 } },
    })).toEqual({ updateId: 42, chatId: 12345, userId: 12345, text: "hello POLYON" });

    expect(parseTelegramInboundCommand({
      update_id: 43,
      message: { text: "hello", chat: { id: 12345, type: "group" }, from: { id: 12345 } },
    })).toBeUndefined();
  });

  it("parses and deduplicates allowlisted chat IDs", () => {
    expect(parseTelegramAllowedChatIds("123, 456,123")).toEqual([123, 456]);
    expect(parseTelegramAllowedChatIds("")).toEqual([]);
  });

  it("allows only low-risk replies through the Telegram integration", () => {
    const policy = buildTelegramReplyPolicy("2026-10-02T00:00:00.000Z");
    expect(policy.defaultEffect).toBe("REQUIRE_APPROVAL");
    expect(policy.rules[0]).toMatchObject({
      integrationId: "telegram-primary",
      action: "EXTERNAL_COMMUNICATION",
      riskLevel: "LOW",
      effect: "ALLOW",
    });
  });
});
