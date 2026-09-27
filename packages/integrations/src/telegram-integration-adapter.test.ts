import { describe, expect, it, vi } from "vitest";

import type { SecretReference } from "@polyon/contracts";
import {
  BoundedHttpClient,
  TelegramIntegrationAdapter,
  TelegramIntegrationAdapterError,
} from "./index";

function createClient(response: Record<string, unknown>, status = 200) {
  return {
    request: vi.fn(async () => ({
      url: "https://api.telegram.org/botREDACTED/sendMessage",
      status,
      statusText: status === 200 ? "OK" : "Error",
      headers: { "content-type": "application/json" },
      body: new TextEncoder().encode(JSON.stringify(response)),
    })),
  } as unknown as BoundedHttpClient;
}

const secretReference: SecretReference = {
  id: "telegram.primary",
  kind: "API_KEY",
  provider: "telegram",
};

describe("TelegramIntegrationAdapter", () => {
  it("sends a bounded text message through the Telegram Bot API", async () => {
    const client = createClient({
      ok: true,
      result: {
        message_id: 42,
        date: 1_000,
        text: "Hello",
        chat: {
          id: 99,
        },
      },
    });
    const secretResolver = {
      resolve: vi.fn(async () => "123456:secret-token"),
    };

    const adapter = new TelegramIntegrationAdapter({
      integrationId: "telegram-primary",
      secretResolver,
      secretReference,
      client,
    });

    const result = await adapter.invoke({
      invocationId: "telegram-invocation-1",
      operation: "SEND_MESSAGE",
      input: {
        chatId: 99,
        text: "Hello",
        disableNotification: true,
      },
    });

    expect(secretResolver.resolve).toHaveBeenCalledWith(secretReference);
    expect(result.output).toEqual({
      messageId: 42,
      chatId: 99,
      date: 1_000,
      text: "Hello",
    });

    const request = client.request as unknown as ReturnType<typeof vi.fn>;
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://api.telegram.org/bot123456:secret-token/sendMessage",
        method: "POST",
        body: JSON.stringify({
          chat_id: 99,
          text: "Hello",
          disable_notification: true,
        }),
      }),
      expect.anything(),
    );
  });

  it("rejects text longer than the Bot API limit", async () => {
    const client = createClient({ ok: true, result: {} });
    const secretResolver = {
      resolve: vi.fn(async () => "token"),
    };
    const adapter = new TelegramIntegrationAdapter({
      integrationId: "telegram-primary",
      secretResolver,
      secretReference,
      client,
    });

    await expect(
      adapter.invoke({
        invocationId: "telegram-invocation-2",
        operation: "SEND_MESSAGE",
        input: {
          chatId: "chat",
          text: "x".repeat(4097),
        },
      }),
    ).rejects.toMatchObject({
      kind: "INVALID_INPUT",
    });

    expect(secretResolver.resolve).not.toHaveBeenCalled();
    expect(client.request).not.toHaveBeenCalled();
  });

  it("maps a rejected Bot API response without exposing the token", async () => {
    const client = createClient(
      {
        ok: false,
        description: "Unauthorized",
      },
      401,
    );
    const secretResolver = {
      resolve: vi.fn(async () => "123456:secret-token"),
    };
    const adapter = new TelegramIntegrationAdapter({
      integrationId: "telegram-primary",
      secretResolver,
      secretReference,
      client,
    });

    await expect(
      adapter.invoke({
        invocationId: "telegram-invocation-3",
        operation: "SEND_MESSAGE",
        input: {
          chatId: "chat",
          text: "Hello",
        },
      }),
    ).rejects.toMatchObject({
      kind: "AUTHENTICATION_ERROR",
    });
  });

  it("rejects unsupported operations and invalid secret metadata", async () => {
    const client = createClient({ ok: true, result: {} });
    const secretResolver = {
      resolve: vi.fn(async () => "token"),
    };

    expect(
      () =>
        new TelegramIntegrationAdapter({
          integrationId: "telegram-primary",
          secretResolver,
          secretReference: {
            ...secretReference,
            provider: "email",
          },
          client,
        }),
    ).toThrow(RangeError);

    const adapter = new TelegramIntegrationAdapter({
      integrationId: "telegram-primary",
      secretResolver,
      secretReference,
      client,
    });

    await expect(
      adapter.invoke({
        invocationId: "telegram-invocation-4",
        operation: "DELETE_MESSAGE",
        input: {},
      }),
    ).rejects.toMatchObject({
      kind: "INVALID_INPUT",
    });
  });

  it("declares the governed communication capability", () => {
    const adapter = new TelegramIntegrationAdapter({
      integrationId: "telegram-primary",
      secretResolver: {
        resolve: vi.fn(async () => "token"),
      },
      secretReference,
      client: createClient({ ok: true, result: {} }),
    });

    expect(adapter.kind).toBe("TELEGRAM");
    expect(adapter.actionKinds).toEqual(["EXTERNAL_COMMUNICATION"]);
    expect(adapter.supportedOperations).toEqual(["SEND_MESSAGE"]);
  });
});
