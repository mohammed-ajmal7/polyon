import type { EmbeddingRequest, EmbeddingResponse, Model, ModelId, Provider } from "@polyon/contracts";

import type { EmbeddingAdapterRegistry } from "./embedding-adapter";
import { normalizeProviderInvocationError } from "./provider-errors";

export interface EmbeddingGatewayDependencies {
  readonly models: { get(modelId: ModelId): Model | undefined };
  readonly providers: { get(providerId: Provider["id"]): Provider | undefined };
  readonly adapters: EmbeddingAdapterRegistry;
}

export class EmbeddingGateway {
  constructor(private readonly dependencies: EmbeddingGatewayDependencies) {}

  async embed(
    modelId: ModelId,
    input: EmbeddingRequest,
    options: { readonly retries?: number; readonly signal?: AbortSignal } = {},
  ): Promise<EmbeddingResponse> {
    if (input.input.length === 0 || input.input.length > 32) {
      throw new RangeError("Embedding requests must contain between 1 and 32 inputs.");
    }
    if (input.input.some((value) => value.trim() === "" || value.length > 16_000)) {
      throw new RangeError("Embedding inputs must be non-empty and at most 16000 characters.");
    }

    const retries = options.retries ?? 0;
    if (!Number.isInteger(retries) || retries < 0 || retries > 3) {
      throw new RangeError("Embedding retries must be an integer between 0 and 3.");
    }

    const model = this.dependencies.models.get(modelId);
    if (model === undefined) throw new EmbeddingGatewayError("MODEL_NOT_FOUND", modelId);
    if (model.kind !== "EMBEDDING") throw new EmbeddingGatewayError("MODEL_KIND_UNSUPPORTED", modelId);
    if (!model.enabled) throw new EmbeddingGatewayError("MODEL_DISABLED", modelId);

    const provider = this.dependencies.providers.get(model.providerId);
    if (provider === undefined) throw new EmbeddingGatewayError("PROVIDER_NOT_FOUND", modelId);
    if (!provider.enabled) throw new EmbeddingGatewayError("PROVIDER_DISABLED", modelId);

    const adapter = this.dependencies.adapters.get(provider.id);
    if (adapter === undefined) {
      throw new EmbeddingGatewayError("PROVIDER_ADAPTER_NOT_FOUND", modelId);
    }

    let attempt = 0;
    while (true) {
      try {
        return (await adapter.embed({ modelId, input, signal: options.signal })).output;
      } catch (error) {
        const normalized = normalizeProviderInvocationError(error, provider.id, modelId);
        if (!normalized.retryable || attempt >= retries) throw normalized;
        attempt += 1;
      }
    }
  }
}

export type EmbeddingGatewayErrorKind =
  | "MODEL_NOT_FOUND"
  | "MODEL_KIND_UNSUPPORTED"
  | "MODEL_DISABLED"
  | "PROVIDER_NOT_FOUND"
  | "PROVIDER_DISABLED"
  | "PROVIDER_ADAPTER_NOT_FOUND";

export class EmbeddingGatewayError extends Error {
  readonly kind: EmbeddingGatewayErrorKind;
  readonly modelId: ModelId;

  constructor(kind: EmbeddingGatewayErrorKind, modelId: ModelId) {
    super(`Embedding model routing failed (${kind}): ${modelId}.`);
    this.name = "EmbeddingGatewayError";
    this.kind = kind;
    this.modelId = modelId;
  }
}
