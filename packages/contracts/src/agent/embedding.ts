export interface EmbeddingRequest {
  readonly input: readonly string[];
}

export interface EmbeddingResponse {
  readonly vectors: readonly (readonly number[])[];
}
