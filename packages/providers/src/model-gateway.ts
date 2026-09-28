import type {
  Model,
  ModelId,
  Provider,
  TextModelRequest,
  TextModelResponse,
} from "@polyon/contracts";

import type {
  ModelProviderAdapter,
  ProviderInvocationRequest,
  ProviderInvocationResult,
} from "./provider-adapter";
import { normalizeProviderInvocationError, ProviderInvocationError } from "./provider-errors";
import type { ProviderAdapterRegistry } from "./provider-adapter-registry";
import {
  UsageGovernor,
  type UsageCostClass,
  type UsageInvocationContext,
} from "./usage-governor";

export type ModelGatewayErrorKind =
  | "MODEL_NOT_FOUND"
  | "MODEL_DISABLED"
  | "PROVIDER_NOT_FOUND"
  | "PROVIDER_DISABLED"
  | "PROVIDER_ADAPTER_NOT_FOUND"
  | "MODEL_KIND_UNSUPPORTED";

export interface ModelInvocationOptions {
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
  readonly retries?: number;
  readonly usageContext?: UsageInvocationContext;
  readonly estimatedTokens?: number;
}

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

export interface ModelCatalog {
  get(modelId: ModelId): Model | undefined;
}

export interface ProviderCatalog {
  get(providerId: Provider["id"]): Provider | undefined;
}

export interface ModelGatewayDependencies {
  readonly models: ModelCatalog;
  readonly providers: ProviderCatalog;
  readonly adapters: ProviderAdapterRegistry;
  readonly usageGovernor?: UsageGovernor;
}

export class ModelGateway {
  constructor(private readonly dependencies: ModelGatewayDependencies) {}

  invokeText(
    modelId: ModelId,
    request: TextModelRequest,
    options: ModelInvocationOptions = {},
  ): Promise<ProviderInvocationResult<TextModelResponse>> {
    const model = this.dependencies.models.get(modelId);

    if (model === undefined) {
      throw new ModelGatewayError("MODEL_NOT_FOUND", modelId, `Model not found: ${modelId}.`);
    }

    if (model.kind !== "TEXT") {
      throw new ModelGatewayError(
        "MODEL_KIND_UNSUPPORTED",
        modelId,
        `Text invocation requires a TEXT model: ${modelId}.`,
      );
    }

    return this.invoke<TextModelRequest, TextModelResponse>(
      modelId,
      request,
      options.estimatedTokens === undefined
        ? {
            ...options,
            estimatedTokens: estimateTextModelTokens(request),
          }
        : options,
    );
  }

  invoke<TInput = unknown, TOutput = unknown>(
    modelId: ModelId,
    input: TInput,
    options: ModelInvocationOptions = {},
  ): Promise<ProviderInvocationResult<TOutput>> {
    const model = this.dependencies.models.get(modelId);

    if (model === undefined) {
      throw new ModelGatewayError("MODEL_NOT_FOUND", modelId, `Model not found: ${modelId}.`);
    }

    if (!model.enabled) {
      throw new ModelGatewayError("MODEL_DISABLED", modelId, `Model is disabled: ${modelId}.`);
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

    if (
      options.timeoutMs !== undefined &&
      (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0)
    ) {
      throw new RangeError("Model invocation timeout must be a positive finite number.");
    }

    if (
      options.retries !== undefined &&
      (!Number.isInteger(options.retries) || options.retries < 0)
    ) {
      throw new RangeError("Model invocation retries must be a non-negative integer.");
    }

    return this.invokeWithRetry<TInput, TOutput>(adapter, provider, modelId, input, options);
  }

  private async invokeWithRetry<TInput, TOutput>(
    adapter: ModelProviderAdapter,
    provider: Provider,
    modelId: ModelId,
    input: TInput,
    options: ModelInvocationOptions,
  ): Promise<ProviderInvocationResult<TOutput>> {
    let attempt = 0;
    const maxRetries = options.retries ?? 0;

    while (true) {
      try {
        const reservation = this.dependencies.usageGovernor?.authorize({
          providerId: provider.id,
          modelId,
          estimatedTokens: options.estimatedTokens,
          context: {
            ...options.usageContext,
            costClass:
              options.usageContext?.costClass ?? effectiveCostClass(model, provider),
          },
        });

        try {
          const result = await this.invokeOnce<TInput, TOutput>(
            adapter,
            modelId,
            input,
            options,
          );
          reservation?.complete(extractUsageTokens(result));
          return result;
        } catch (error) {
          reservation?.complete();
          const normalized = normalizeProviderInvocationError(error, provider.id, modelId);

          if (!normalized.retryable || attempt >= maxRetries) {
            throw normalized;
          }

          attempt += 1;
        }
      }
    }
  }

  private async invokeOnce<TInput, TOutput>(
    adapter: ModelProviderAdapter,
    modelId: ModelId,
    input: TInput,
    options: ModelInvocationOptions,
  ): Promise<ProviderInvocationResult<TOutput>> {
    const timeoutMs = options.timeoutMs;
    const controller = new AbortController();
    let providerPromise: Promise<ProviderInvocationResult<TOutput>>;

    try {
      providerPromise = Promise.resolve(
        adapter.invoke({
          modelId,
          input,
          signal: controller.signal,
        }),
      ) as Promise<ProviderInvocationResult<TOutput>>;
    } catch (error) {
      providerPromise = Promise.reject(error);
    }

    let timeout: ReturnType<typeof setTimeout> | undefined;
    let removeAbortListener: (() => void) | undefined;

    const cancellationPromise =
      options.signal === undefined
        ? undefined
        : new Promise<never>((_, reject) => {
            if (options.signal?.aborted) {
              controller.abort();
              reject(
                new ProviderInvocationError(
                  "CANCELLED",
                  adapter.providerId,
                  modelId,
                  `Provider invocation was cancelled for model: ${modelId}.`,
                  false,
                ),
              );
              return;
            }

            const onAbort = () => {
              controller.abort();
              reject(
                new ProviderInvocationError(
                  "CANCELLED",
                  adapter.providerId,
                  modelId,
                  `Provider invocation was cancelled for model: ${modelId}.`,
                  false,
                ),
              );
            };

            options.signal?.addEventListener("abort", onAbort, { once: true });
            removeAbortListener = () => options.signal?.removeEventListener("abort", onAbort);
          });

    const timeoutPromise =
      timeoutMs === undefined
        ? undefined
        : new Promise<never>((_, reject) => {
            timeout = setTimeout(() => {
              controller.abort();
              reject(
                new ProviderInvocationError(
                  "TIMEOUT",
                  adapter.providerId,
                  modelId,
                  `Provider invocation timed out after ${timeoutMs}ms for model: ${modelId}.`,
                  true,
                ),
              );
            }, timeoutMs);
          });

    try {
      const races: Promise<ProviderInvocationResult<TOutput> | never>[] = [
        providerPromise as Promise<ProviderInvocationResult<TOutput>>,
      ];

      if (cancellationPromise !== undefined) {
        races.push(cancellationPromise);
      }

      if (timeoutPromise !== undefined) {
        races.push(timeoutPromise);
      }

      return await Promise.race(races);
    } finally {
      if (timeout !== undefined) {
        clearTimeout(timeout);
      }
      removeAbortListener?.();
    }
  }
}

function estimateTextModelTokens(request: TextModelRequest): number {
  const serializedLength = JSON.stringify(request).length;
  const inputEstimate = Math.ceil(serializedLength / 4);
  return inputEstimate + (request.maxOutputTokens ?? 0);
}

function extractUsageTokens<TOutput>(
  result: ProviderInvocationResult<TOutput>,
): number | undefined {
  const output = result.output;

  if (
    typeof output === "object" &&
    output !== null &&
    "usage" in output &&
    typeof output.usage === "object" &&
    output.usage !== null &&
    "totalTokens" in output.usage &&
    typeof output.usage.totalTokens === "number"
  ) {
    return output.usage.totalTokens;
  }

  return undefined;
}

function effectiveCostClass(model: Model, provider: Provider): UsageCostClass {
  if (model.costClass !== undefined) {
    return model.costClass;
  }

  return provider.kind === "LOCAL_MODEL" ? "free" : "unknown";
}
