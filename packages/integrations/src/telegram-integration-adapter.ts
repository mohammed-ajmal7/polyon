import type { SecretReference } from "@polyon/contracts";

import type {
  IntegrationAdapter,
  IntegrationInvocationRequest,
  IntegrationInvocationResult,
} from "./integration-adapter";
import { BoundedHttpClient, BoundedHttpClientError } from "./bounded-http-client";
import type { SecretResolver } from "./secret-resolver";

export type TelegramOperation = "SEND_MESSAGE";
export type TelegramParseMode = "Markdown" | "MarkdownV2" | "HTML";

export interface TelegramSendMessageInput {
  readonly chatId: string | number;
  readonly text: string;
  readonly parseMode?: TelegramParseMode;
  readonly disableNotification?: boolean;
  readonly protectContent?: boolean;
  readonly messageThreadId?: number;
}

export interface TelegramSendMessageOutput {
  readonly messageId: number;
  readonly chatId: string | number;
  readonly date: number;
  readonly text?: string;
}

export type TelegramIntegrationAdapterErrorKind =
  "INVALID_INPUT" | "INVALID_RESPONSE" | "AUTHENTICATION_ERROR" | "API_ERROR" | "NETWORK_ERROR";

export class TelegramIntegrationAdapterError extends Error {
  readonly kind: TelegramIntegrationAdapterErrorKind;

  constructor(kind: TelegramIntegrationAdapterErrorKind, message: string) {
    super(message);
    this.name = "TelegramIntegrationAdapterError";
    this.kind = kind;
  }
}

export interface TelegramIntegrationAdapterOptions {
  readonly integrationId: string;
  readonly secretResolver: SecretResolver;
  readonly secretReference: SecretReference;
  readonly client?: BoundedHttpClient;
  readonly maxResponseBytes?: number;
  readonly maxRequestBytes?: number;
  readonly defaultTimeoutMs?: number;
  readonly maxTimeoutMs?: number;
}

export class TelegramIntegrationAdapter implements IntegrationAdapter {
  readonly integrationId: string;
  readonly kind = "TELEGRAM" as const;
  readonly actionKinds = ["EXTERNAL_COMMUNICATION"] as const;
  readonly supportedOperations = ["SEND_MESSAGE"] as const;

  private readonly secretResolver: SecretResolver;
  private readonly secretReference: SecretReference;
  private readonly http: BoundedHttpClient;
  private readonly maxResponseBytes?: number;
  private readonly maxRequestBytes?: number;

  constructor(options: TelegramIntegrationAdapterOptions) {
    if (options.integrationId.trim() === "") {
      throw new RangeError("integrationId must not be empty.");
    }

    if (options.secretReference.provider !== "telegram") {
      throw new RangeError("Telegram integration requires a Telegram secret reference.");
    }

    if (options.secretReference.kind !== "API_KEY") {
      throw new RangeError("Telegram integration requires an API-key reference.");
    }

    this.integrationId = options.integrationId;
    this.secretResolver = options.secretResolver;
    this.secretReference = options.secretReference;
    this.maxResponseBytes = options.maxResponseBytes;
    this.maxRequestBytes = options.maxRequestBytes;

    this.http =
      options.client ??
      new BoundedHttpClient({
        allowedHosts: ["api.telegram.org"],
        allowedPorts: [443],
        defaultTimeoutMs: options.defaultTimeoutMs ?? 15_000,
        maxTimeoutMs: options.maxTimeoutMs ?? 30_000,
        defaultMaxResponseBytes: options.maxResponseBytes ?? 524_288,
        maxResponseBytes: options.maxResponseBytes ?? 524_288,
        defaultMaxRequestBytes: options.maxRequestBytes ?? 16_384,
        maxRequestBytes: options.maxRequestBytes ?? 16_384,
      });
  }

  async invoke(
    request: IntegrationInvocationRequest<unknown>,
  ): Promise<IntegrationInvocationResult<TelegramSendMessageOutput>> {
    if (request.operation !== "SEND_MESSAGE") {
      throw new TelegramIntegrationAdapterError(
        "INVALID_INPUT",
        `Unsupported Telegram operation: ${request.operation}.`,
      );
    }

    const input = parseSendMessageInput(request.input);
    const token = await this.secretResolver.resolve(this.secretReference);

    const payload: Record<string, unknown> = {
      chat_id: input.chatId,
      text: input.text,
      ...(input.parseMode === undefined ? {} : { parse_mode: input.parseMode }),
      ...(input.disableNotification === undefined
        ? {}
        : { disable_notification: input.disableNotification }),
      ...(input.protectContent === undefined ? {} : { protect_content: input.protectContent }),
      ...(input.messageThreadId === undefined ? {} : { message_thread_id: input.messageThreadId }),
    };

    try {
      const response = await this.http.request(
        {
          url: `https://api.telegram.org/bot${token}/sendMessage`,
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        },
        {
          ...(this.maxResponseBytes === undefined
            ? {}
            : { maxResponseBytes: this.maxResponseBytes }),
          ...(this.maxRequestBytes === undefined ? {} : { maxRequestBytes: this.maxRequestBytes }),
        },
      );

      if (response.status === 401 || response.status === 403) {
        throw new TelegramIntegrationAdapterError(
          "AUTHENTICATION_ERROR",
          `Telegram sendMessage returned HTTP ${response.status}.`,
        );
      }

      if (response.status < 200 || response.status >= 300) {
        throw new TelegramIntegrationAdapterError(
          "API_ERROR",
          `Telegram sendMessage returned HTTP ${response.status}.`,
        );
      }

      const value = parseJsonBody(response.body);

      if (value.ok !== true) {
        throw new TelegramIntegrationAdapterError(
          "API_ERROR",
          "Telegram sendMessage was rejected by the Bot API.",
        );
      }

      return {
        output: parseSuccessfulMessage(value.result),
      };
    } catch (error) {
      if (error instanceof TelegramIntegrationAdapterError) {
        throw error;
      }

      if (error instanceof BoundedHttpClientError) {
        throw new TelegramIntegrationAdapterError(
          "NETWORK_ERROR",
          `Telegram Bot API request failed: ${error.kind}.`,
        );
      }

      throw error;
    }
  }
}

function parseSendMessageInput(input: unknown): TelegramSendMessageInput {
  if (input === null || typeof input !== "object") {
    throw new TelegramIntegrationAdapterError(
      "INVALID_INPUT",
      "SEND_MESSAGE requires an object input.",
    );
  }

  const value = input as Record<string, unknown>;
  const chatId = value.chatId;
  const text = value.text;

  if (
    (typeof chatId !== "string" && typeof chatId !== "number") ||
    (typeof chatId === "string" && (chatId.trim() === "" || chatId.length > 200)) ||
    (typeof chatId === "number" && !Number.isSafeInteger(chatId))
  ) {
    throw new TelegramIntegrationAdapterError(
      "INVALID_INPUT",
      "Telegram chatId must be a non-empty string or safe integer.",
    );
  }

  if (typeof text !== "string" || text.length === 0 || Array.from(text).length > 4096) {
    throw new TelegramIntegrationAdapterError(
      "INVALID_INPUT",
      "Telegram message text must contain 1-4096 characters.",
    );
  }

  if (
    value.parseMode !== undefined &&
    value.parseMode !== "Markdown" &&
    value.parseMode !== "MarkdownV2" &&
    value.parseMode !== "HTML"
  ) {
    throw new TelegramIntegrationAdapterError(
      "INVALID_INPUT",
      "Telegram parseMode must be Markdown, MarkdownV2, or HTML.",
    );
  }

  if (
    value.messageThreadId !== undefined &&
    (!Number.isSafeInteger(value.messageThreadId) || (value.messageThreadId as number) <= 0)
  ) {
    throw new TelegramIntegrationAdapterError(
      "INVALID_INPUT",
      "Telegram messageThreadId must be a positive safe integer.",
    );
  }

  for (const field of ["disableNotification", "protectContent"] as const) {
    if (value[field] !== undefined && typeof value[field] !== "boolean") {
      throw new TelegramIntegrationAdapterError(
        "INVALID_INPUT",
        `Telegram ${field} must be a boolean when provided.`,
      );
    }
  }

  return {
    chatId: chatId as string | number,
    text,
    ...(value.parseMode === undefined ? {} : { parseMode: value.parseMode as TelegramParseMode }),
    ...(value.disableNotification === undefined
      ? {}
      : { disableNotification: value.disableNotification as boolean }),
    ...(value.protectContent === undefined
      ? {}
      : { protectContent: value.protectContent as boolean }),
    ...(value.messageThreadId === undefined
      ? {}
      : { messageThreadId: value.messageThreadId as number }),
  };
}

function parseJsonBody(body: Uint8Array): Record<string, unknown> {
  const text = new TextDecoder().decode(body);

  try {
    const value: unknown = JSON.parse(text);
    if (value === null || typeof value !== "object") {
      throw new Error("response root is not an object");
    }

    return value as Record<string, unknown>;
  } catch {
    throw new TelegramIntegrationAdapterError(
      "INVALID_RESPONSE",
      "Telegram returned an invalid JSON response.",
    );
  }
}

function parseSuccessfulMessage(value: unknown): TelegramSendMessageOutput {
  if (value === null || typeof value !== "object") {
    throw new TelegramIntegrationAdapterError(
      "INVALID_RESPONSE",
      "Telegram sendMessage response is missing the Message object.",
    );
  }

  const message = value as Record<string, unknown>;
  const chat =
    message.chat !== null && typeof message.chat === "object"
      ? (message.chat as Record<string, unknown>)
      : undefined;

  if (
    !Number.isSafeInteger(message.message_id) ||
    !Number.isSafeInteger(message.date) ||
    chat === undefined ||
    (typeof chat.id !== "number" && typeof chat.id !== "string")
  ) {
    throw new TelegramIntegrationAdapterError(
      "INVALID_RESPONSE",
      "Telegram sendMessage response is missing required message fields.",
    );
  }

  return {
    messageId: message.message_id as number,
    chatId: chat.id as string | number,
    date: message.date as number,
    ...(typeof message.text === "string" ? { text: message.text } : {}),
  };
}
