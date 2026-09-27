import type { ModelId } from "./ids";

export interface EmbeddingRequest {
  readonly input: readonly string[];
}

export interface EmbeddingResponse {
  readonly vectors: readonly (readonly number[])[];
}

export interface EmbeddingModelProviderAdapter {
  readonly providerId: string;
  embed(
    request: {
      readonly modelId: ModelId;
      readonly input: EmbeddingRequest;
      readonly signal?: AbortSignal;
    },
  ): Promise<{ readonly output: EmbeddingResponse }>;
}
