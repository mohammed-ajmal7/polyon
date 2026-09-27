import type { ModelId } from "./ids";

export interface EmbeddingRequest {
  readonly input: readonly string[];
}

export interface EmbeddingResponse {
  readonly vectors: readonly (readonly number[])[];
}

export type EmbeddingModelId = ModelId;
