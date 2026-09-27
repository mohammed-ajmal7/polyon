import type { ModelId } from "@polyon/contracts";

import type { ModelRegistry } from "@polyon/agents";
import type { ProviderRegistry } from "@polyon/agents";

import type {
  ModelProviderAdapter,
  ProviderInvocationRequest,
  ProviderInvocationResult,
} from "./provider-adapter";
import type { ProviderAdapterRegistry } from "./provider-adapter-registry";

export type ModelGatewayErrorKind =
  | "MODEL_NOT_FOUND"
  | "MODEL_DISABLED"
  | "PROVIDER_NOT_FOUND"
  | "PROVIDER_DISABLED"
  | "PROVIDER_ADAPTER_NOT_FOUND";

export class ModelGatewayError extends Error {
  readonly kind: ModelGatewayErrorKind;
  readonly modelId: ModelId;

  constructor(kind: ModelGatewayErrorKind, modelId: ModelId, message: string) {
    super(message);
    this.name = "ModelGatewayError";
    this.kind = kind;
    this.modelId = modelId;
  }
}

export interface ModelGatewayDependencies {
  readonly models: ModelRegistry;
  readonly providers: ProviderRegistry;
  readonly adapters: ProviderAdapterRegistry;
}

export class ModelGateway {
  constructor(private readonly dependencies: ModelGatewayDependencies) {}

  invoke<TInput = unknown, TOutput = unknown>(
    modelId: ModelId,
    input: TInput,
  ): Promise<ProviderInvocationResult<TOutput>> {
    const model = this.dependencies.models.get(modelId);

    if (model === undefined) {
      throw new ModelGatewayError(
        "MODEL_NOT_FOUND",
        modelId,
        `Model not found: ${modelId}.`,
      );
    }

    if (!model.enabled) {
      throw new ModelGatewayError(
        "MODEL_DISABLED",
        modelId,
        `Model is disabled: ${modelId}.`,
      );
    }

    const provider = this.dependencies.providers.get(model.providerId);

    if (provider === undefined) {
      throw new ModelGatewayError(
        "PROVIDER_NOT_FOUND",
        modelId,
        `Provider not found: ${model.providerId}.`,
      );
    }

    if (!provider.enabled) {
      throw new ModelGatewayError(
        "PROVIDER_DISABLED",
        modelId,
        `Provider is disabled: ${provider.id}.`,
      );
    }

    const adapter = this.dependencies.adapters.get(provider.id);

    if (adapter === undefined) {
      throw new ModelGatewayError(
        "PROVIDER_ADAPTER_NOT_FOUND",
        modelId,
        `No adapter is registered for provider: ${provider.id}.`,
      );
    }

    const request: ProviderInvocationRequest<TInput> = {
      modelId,
      input,
    };

    return adapter.invoke(request) as Promise<ProviderInvocationResult<TOutput>>;
  }
}
