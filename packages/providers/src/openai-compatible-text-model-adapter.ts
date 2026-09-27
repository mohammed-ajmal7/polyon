import type {
  TextModelFinishReason,
  TextModelRequest,
  TextModelResponse,
  TextModelUsage,
} from "@polyon/contracts";

import { ProviderInvocationError } from "./provider-errors";
import type { TextModelProviderAdapter, ProviderInvocationResult } from "./provider-adapter";

export interface OpenAICompatibleTextModelAdapterOptions {
  readonly providerId: string;
  readonly endpoint: string;
  readonly apiKey?: string;
  readonly fetch?: OpenAICompatibleFetch;
}

export interface OpenAICompatibleFetchInit {
  readonly method: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
  readonly signal?: AbortSignal;
}

export interface OpenAICompatibleResponse {
  readonly ok: boolean;
  readonly status: number;
  json(): Promise<unknown>;
}

export type OpenAICompatibleFetch = (
  input: string,
  init: OpenAICompatibleFetchInit,
) => Promise<OpenAICompatibleResponse>;

interface OpenAIChatResponse {
  readonly choices?: readonly {
    readonly message?: {
      readonly content?: unknown;
    };
    readonly finish_reason?: unknown;
  }[];
  readonly usage?: {
    readonly prompt_tokens?: unknown;
    readonly completion_tokens?: unknown;
    readonly total_tokens?: unknown;
  };
}

export class OpenAICompatibleTextModelAdapter implements TextModelProviderAdapter {
  readonly providerId: OpenAICompatibleTextModelAdapterOptions["providerId"];

  private readonly endpoint: string;
  private readonly apiKey?: string;
  private readonly fetchImpl: OpenAICompatibleFetch;

  constructor(options: OpenAICompatibleTextModelAdapterOptions) {
    if (options.endpoint.trim().length === 0) {
      throw new RangeError("OpenAI-compatible model endpoint must not be empty.");
    }

    this.providerId = options.providerId;
    this.endpoint = options.endpoint;
    this.apiKey = options.apiKey;
    this.fetchImpl =
      options.fetch ??
      ((input, init) =>
        globalThis.fetch(input, init as unknown as RequestInit) as Promise<
          OpenAICompatibleResponse
        >);
  }

  async invoke({
    modelId,
    input,
    signal,
  }: {
    readonly modelId: string;
    readonly input: TextModelRequest;
    readonly signal?: AbortSignal;
  }): Promise<ProviderInvocationResult<TextModelResponse>> {
    const response = await this.request(modelId, input, signal);
    const payload = await response.json();

    if (!response.ok) {
      throw this.mapHttpError(response.status, modelId, payload);
    }

    return {
      output: this.parseSuccessResponse(modelId, payload),
    };
  }

  private async request(
    modelId: string,
    input: TextModelRequest,
    signal?: AbortSignal,
  ): Promise<OpenAICompatibleResponse> {
    const headers: Record<string, string> = {
      "content-type": "application/json",
    };

    if (this.apiKey !== undefined) {
      headers.authorization = `Bearer ${this.apiKey}`;
    }

    return this.fetchImpl(this.endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: modelId,
        messages: input.messages,
        ...(input.temperature === undefined ? {} : { temperature: input.temperature }),
        ...(input.maxOutputTokens === undefined
          ? {}
          : { max_tokens: input.maxOutputTokens }),
      }),
      signal,
    });
  }

  private parseSuccessResponse(modelId: string, payload: unknown): TextModelResponse {
    if (!isRecord(payload)) {
      throw new ProviderInvocationError(
        "UNKNOWN",
        this.providerId,
        modelId,
        "Provider returned an invalid response payload.",
        false,
      );
    }

    const body = payload as OpenAIChatResponse;
    const choice = body.choices?.[0];
    const content = choice?.message?.content;

    if (typeof content !== "string") {
      throw new ProviderInvocationError(
        "UNKNOWN",
        this.providerId,
        modelId,
        "Provider response did not contain a text message.",
        false,
      );
    }

    return {
      content,
      ...(mapFinishReason(choice?.finish_reason) === undefined
        ? {}
        : { finishReason: mapFinishReason(choice?.finish_reason) }),
      ...(mapUsage(body.usage) === undefined ? {} : { usage: mapUsage(body.usage) }),
    };
  }

  private mapHttpError(
    status: number,
    modelId: string,
    payload: unknown,
  ): ProviderInvocationError {
    const message = extractErrorMessage(payload) ?? `Provider request failed with HTTP ${status}.`;

    if (status === 408) {
      return new ProviderInvocationError(
        "TIMEOUT",
        this.providerId,
        modelId,
        message,
        true,
      );
    }

    if (status === 429) {
      return new ProviderInvocationError(
        "RATE_LIMITED",
        this.providerId,
        modelId,
        message,
        true,
      );
    }

    if (status === 401 || status === 403) {
      return new ProviderInvocationError(
        "AUTHENTICATION",
        this.providerId,
        modelId,
        message,
        false,
      );
    }

    if (status === 400 || status === 404 || status === 422) {
      return new ProviderInvocationError(
        "INVALID_REQUEST",
        this.providerId,
        modelId,
        message,
        false,
      );
    }

    if (status >= 500) {
      return new ProviderInvocationError(
        "UNAVAILABLE",
        this.providerId,
        modelId,
        message,
        true,
      );
    }

    return new ProviderInvocationError(
      "UNKNOWN",
      this.providerId,
      modelId,
      message,
      false,
    );
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function extractErrorMessage(payload: unknown): string | undefined {
  if (!isRecord(payload)) {
    return undefined;
  }

  const error = payload.error;

  if (!isRecord(error)) {
    return undefined;
  }

  return typeof error.message === "string" ? error.message : undefined;
}

function mapFinishReason(value: unknown): TextModelFinishReason | undefined {
  if (value === "stop") {
    return "STOP";
  }

  if (value === "length") {
    return "LENGTH";
  }

  if (value === "tool_calls" || value === "function_call") {
    return "TOOL_CALL";
  }

  return value === undefined ? undefined : "OTHER";
}

function mapUsage(value: OpenAIChatResponse["usage"]): TextModelUsage | undefined {
  if (value === undefined) {
    return undefined;
  }

  const usage: TextModelUsage = {
    ...(typeof value.prompt_tokens === "number"
      ? { inputTokens: value.prompt_tokens }
      : {}),
    ...(typeof value.completion_tokens === "number"
      ? { outputTokens: value.completion_tokens }
      : {}),
    ...(typeof value.total_tokens === "number" ? { totalTokens: value.total_tokens } : {}),
  };

  return Object.keys(usage).length === 0 ? undefined : usage;
}
