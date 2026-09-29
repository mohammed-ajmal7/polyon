import type {
  ModelId,
  ProviderId,
  TextModelFinishReason,
  TextModelRequest,
  TextModelResponse,
  TextModelUsage,
} from "@polyon/contracts";

import { ProviderInvocationError } from "./provider-errors";
import type { TextModelProviderAdapter, ProviderInvocationResult } from "./provider-adapter";

export interface OpenAICompatibleTextModelAdapterOptions {
  readonly providerId: ProviderId;
  readonly endpoint: string;
  readonly apiKey?: string;
  readonly fetch?: OpenAICompatibleFetch;
  /**
   * Optional `reasoning_effort` for reasoning models (for example "none", "low", "medium",
   * "high"). Omitted from requests when undefined.
   */
  readonly reasoningEffort?: string;
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
      readonly reasoning?: unknown;
      readonly reasoning_content?: unknown;
      readonly tool_calls?: readonly {
        readonly id?: unknown;
        readonly function?: {
          readonly name?: unknown;
          readonly arguments?: unknown;
        };
      }[];
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
  private readonly reasoningEffort?: string;
  private readonly fetchImpl: OpenAICompatibleFetch;

  constructor(options: OpenAICompatibleTextModelAdapterOptions) {
    if (options.endpoint.trim().length === 0) {
      throw new RangeError("OpenAI-compatible model endpoint must not be empty.");
    }

    this.providerId = options.providerId;
    this.endpoint = options.endpoint;
    this.apiKey = options.apiKey;
    this.reasoningEffort = options.reasoningEffort;
    this.fetchImpl =
      options.fetch ??
      ((input, init) =>
        globalThis.fetch(
          input,
          init as unknown as RequestInit,
        ) as Promise<OpenAICompatibleResponse>);
  }

  async invoke({
    modelId,
    input,
    signal,
  }: {
    readonly modelId: ModelId;
    readonly input: TextModelRequest;
    readonly signal?: AbortSignal;
  }): Promise<ProviderInvocationResult<TextModelResponse>> {
    let response: OpenAICompatibleResponse;
    try {
      response = await this.request(modelId, input, signal);
    } catch (error) {
      if (signal?.aborted === true || (error instanceof Error && error.name === "AbortError")) {
        throw error;
      }
      // Network-level failures (connection refused, DNS, header timeouts) surface from fetch as
      // an opaque "fetch failed"; keep the underlying cause and classify them as retryable.
      throw new ProviderInvocationError(
        "UNAVAILABLE",
        this.providerId,
        modelId,
        `Provider request failed: ${describeFetchFailure(error)}.`,
        true,
      );
    }
    const payload: unknown = await response.json().catch(() => undefined);

    if (!response.ok) {
      throw this.mapHttpError(response.status, modelId, payload);
    }

    return {
      output: this.parseSuccessResponse(modelId, payload, input),
    };
  }

  private async request(
    modelId: ModelId,
    input: TextModelRequest,
    signal?: AbortSignal,
  ): Promise<OpenAICompatibleResponse> {
    const headers: Record<string, string> = {
      "content-type": "application/json",
    };

    if (this.apiKey !== undefined) {
      headers.authorization = `Bearer ${this.apiKey}`;
    }

    // Replayed assistant tool calls must use the same provider-safe function names as the
    // tools list; strict providers reject names that are not declared.
    const toolNamesById = new Map((input.tools ?? []).map((tool) => [tool.toolId, tool.name]));

    return this.fetchImpl(this.endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: modelId,
        messages: input.messages.map((message) => toOpenAIMessage(message, toolNamesById)),
        ...(input.tools === undefined
          ? {}
          : {
              tools: input.tools.map((tool) => ({
                type: "function",
                function: {
                  name: tool.name,
                  description: tool.description,
                  ...(tool.inputSchema === undefined ? {} : { parameters: tool.inputSchema }),
                },
              })),
            }),
        ...(input.temperature === undefined ? {} : { temperature: input.temperature }),
        ...(input.maxOutputTokens === undefined ? {} : { max_tokens: input.maxOutputTokens }),
        ...(this.reasoningEffort === undefined ? {} : { reasoning_effort: this.reasoningEffort }),
      }),
      signal,
    });
  }

  private parseSuccessResponse(
    modelId: string,
    payload: unknown,
    request: TextModelRequest,
  ): TextModelResponse {
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
    const toolNames = new Map((request.tools ?? []).map((tool) => [tool.name, tool.toolId]));
    const toolCalls = parseToolCalls(choice?.message?.tool_calls, toolNames);

    const reasoning = choice?.message?.reasoning ?? choice?.message?.reasoning_content;
    if (
      (content === undefined || content === null || content === "") &&
      toolCalls === undefined &&
      typeof reasoning === "string" &&
      reasoning.trim() !== ""
    ) {
      throw new ProviderInvocationError(
        "INVALID_REQUEST",
        this.providerId,
        modelId,
        choice?.finish_reason === "length"
          ? "The model spent its whole output budget on reasoning and returned no answer. " +
              "Increase the model context/output limit or lower the reasoning effort."
          : "The model returned reasoning but no answer.",
        false,
      );
    }

    if (typeof content !== "string" && toolCalls === undefined) {
      throw new ProviderInvocationError(
        "UNKNOWN",
        this.providerId,
        modelId,
        "Provider response did not contain a text message or tool calls.",
        false,
      );
    }

    return {
      content: typeof content === "string" ? content : "",
      ...(mapFinishReason(choice?.finish_reason) === undefined
        ? {}
        : { finishReason: mapFinishReason(choice?.finish_reason) }),
      ...(toolCalls === undefined ? {} : { toolCalls }),
      ...(mapUsage(body.usage) === undefined ? {} : { usage: mapUsage(body.usage) }),
    };
  }

  private mapHttpError(
    status: number,
    modelId: ModelId,
    payload: unknown,
  ): ProviderInvocationError {
    const message = extractErrorMessage(payload) ?? `Provider request failed with HTTP ${status}.`;

    if (status === 408) {
      return new ProviderInvocationError("TIMEOUT", this.providerId, modelId, message, true);
    }

    if (status === 429) {
      return new ProviderInvocationError("RATE_LIMITED", this.providerId, modelId, message, true);
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
      return new ProviderInvocationError("UNAVAILABLE", this.providerId, modelId, message, true);
    }

    return new ProviderInvocationError("UNKNOWN", this.providerId, modelId, message, false);
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
    ...(typeof value.prompt_tokens === "number" ? { inputTokens: value.prompt_tokens } : {}),
    ...(typeof value.completion_tokens === "number"
      ? { outputTokens: value.completion_tokens }
      : {}),
    ...(typeof value.total_tokens === "number" ? { totalTokens: value.total_tokens } : {}),
  };

  return Object.keys(usage).length === 0 ? undefined : usage;
}

function parseToolCalls(
  value: unknown,
  toolNames: ReadonlyMap<string, string>,
): TextModelResponse["toolCalls"] | undefined {
  if (!Array.isArray(value) || value.length === 0) {
    return undefined;
  }

  const calls = [];
  for (const candidate of value) {
    if (!isRecord(candidate) || !isRecord(candidate.function)) {
      continue;
    }

    const id = candidate.id;
    const name = candidate.function.name;
    const rawArguments = candidate.function.arguments;

    if (typeof id !== "string" || typeof name !== "string") {
      continue;
    }

    let input: unknown;
    if (typeof rawArguments === "string") {
      try {
        input = JSON.parse(rawArguments);
      } catch {
        continue;
      }
    } else {
      input = rawArguments;
    }

    calls.push({
      id,
      toolId: toolNames.get(name) ?? name,
      input,
    });
  }

  return calls.length === 0 ? undefined : calls;
}

function toOpenAIMessage(
  message: TextModelRequest["messages"][number],
  toolNamesById: ReadonlyMap<string, string>,
): Record<string, unknown> {
  if (message.role === "ASSISTANT" && message.toolCalls !== undefined) {
    return {
      role: "assistant",
      content: message.content,
      tool_calls: message.toolCalls.map((call) => ({
        id: call.id,
        type: "function",
        function: {
          name: toolNamesById.get(call.toolId) ?? call.toolId,
          arguments: JSON.stringify(call.input),
        },
      })),
    };
  }

  if (message.role === "TOOL") {
    return {
      role: "tool",
      content: message.content,
      tool_call_id: message.toolCallId,
    };
  }

  return {
    role: message.role.toLowerCase(),
    content: message.content,
    ...(message.name === undefined ? {} : { name: message.name }),
  };
}

function describeFetchFailure(error: unknown): string {
  if (!(error instanceof Error)) return "unknown network error";
  const cause = (error as Error & { cause?: unknown }).cause;
  if (cause instanceof Error) {
    const code = (cause as Error & { code?: unknown }).code;
    return typeof code === "string"
      ? `${error.message} (${code})`
      : `${error.message} (${cause.message})`;
  }
  return error.message;
}
