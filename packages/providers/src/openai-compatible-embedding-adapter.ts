import type { EmbeddingRequest, EmbeddingResponse, ModelId, ProviderId } from "@polyon/contracts";
import { ProviderInvocationError } from "./provider-errors";
import type { EmbeddingProviderAdapter } from "./embedding-adapter";

export interface OpenAICompatibleEmbeddingAdapterOptions {
  readonly providerId: ProviderId;
  readonly endpoint: string;
  readonly apiKey?: string;
  readonly fetch?: OpenAICompatibleEmbeddingFetch;
}

export interface OpenAICompatibleEmbeddingFetchInit {
  readonly method: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
  readonly signal?: AbortSignal;
}

export interface OpenAICompatibleEmbeddingResponse {
  readonly ok: boolean;
  readonly status: number;
  json(): Promise<unknown>;
}

export type OpenAICompatibleEmbeddingFetch = (
  input: string,
  init: OpenAICompatibleEmbeddingFetchInit,
) => Promise<OpenAICompatibleEmbeddingResponse>;

export class OpenAICompatibleEmbeddingAdapter implements EmbeddingProviderAdapter {
  readonly providerId: ProviderId;
  private readonly endpoint: string;
  private readonly apiKey?: string;
  private readonly fetchImpl: OpenAICompatibleEmbeddingFetch;

  constructor(options: OpenAICompatibleEmbeddingAdapterOptions) {
    if (options.endpoint.trim() === "")
      throw new RangeError("Embedding endpoint must not be empty.");
    const protocol = new URL(options.endpoint).protocol;
    if (protocol !== "http:" && protocol !== "https:") {
      throw new RangeError("Embedding endpoint must use HTTP(S).");
    }
    this.providerId = options.providerId;
    this.endpoint = options.endpoint;
    this.apiKey = options.apiKey;
    this.fetchImpl =
      options.fetch ??
      ((input, init) =>
        globalThis.fetch(
          input,
          init as unknown as RequestInit,
        ) as Promise<OpenAICompatibleEmbeddingResponse>);
  }

  async embed({
    modelId,
    input,
    signal,
  }: {
    readonly modelId: ModelId;
    readonly input: EmbeddingRequest;
    readonly signal?: AbortSignal;
  }): Promise<{ readonly output: EmbeddingResponse }> {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (this.apiKey !== undefined) headers.authorization = `Bearer ${this.apiKey}`;

    const response = await this.fetchImpl(this.endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({ model: modelId, input: input.input }),
      signal,
    });
    const payload = await response.json();
    if (!response.ok) {
      const message =
        typeof payload === "object" &&
        payload !== null &&
        typeof (payload as { error?: { message?: unknown } }).error?.message === "string"
          ? (payload as { error: { message: string } }).error.message
          : `Embedding provider request failed with HTTP ${response.status}.`;
      throw new ProviderInvocationError(
        response.status === 429
          ? "RATE_LIMITED"
          : response.status >= 500
            ? "UNAVAILABLE"
            : "INVALID_REQUEST",
        this.providerId,
        modelId,
        message,
        response.status === 429 || response.status >= 500,
      );
    }

    if (
      typeof payload !== "object" ||
      payload === null ||
      !Array.isArray((payload as { data?: unknown }).data)
    ) {
      throw new ProviderInvocationError(
        "UNKNOWN",
        this.providerId,
        modelId,
        "Invalid embedding response.",
        false,
      );
    }

    const vectors = (payload as { data: unknown[] }).data.map((item) => {
      if (
        typeof item !== "object" ||
        item === null ||
        !Array.isArray((item as { embedding?: unknown }).embedding)
      ) {
        throw new ProviderInvocationError(
          "UNKNOWN",
          this.providerId,
          modelId,
          "Invalid embedding vector.",
          false,
        );
      }
      const vector = (item as { embedding: unknown[] }).embedding;
      if (vector.length === 0 || vector.length > 16_384) {
        throw new ProviderInvocationError(
          "UNKNOWN",
          this.providerId,
          modelId,
          "Embedding vector is invalid or exceeds bounds.",
          false,
        );
      }

      const numericVector: number[] = [];
      for (const value of vector) {
        if (typeof value !== "number" || !Number.isFinite(value)) {
          throw new ProviderInvocationError(
            "UNKNOWN",
            this.providerId,
            modelId,
            "Embedding vector is invalid or exceeds bounds.",
            false,
          );
        }
        numericVector.push(value);
      }

      return numericVector;
    });

    if (vectors.length !== input.input.length) {
      throw new ProviderInvocationError(
        "UNKNOWN",
        this.providerId,
        modelId,
        "Embedding provider returned an unexpected vector count.",
        false,
      );
    }

    return { output: { vectors } };
  }
}
