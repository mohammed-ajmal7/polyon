import type { ModelId, ProviderId } from "@polyon/contracts";

export interface ProviderInvocationRequest<TInput = unknown> {
  readonly modelId: ModelId;
  readonly input: TInput;
}

export interface ProviderInvocationResult<TOutput = unknown> {
  readonly output: TOutput;
}

export interface ModelProviderAdapter<TInput = unknown, TOutput = unknown> {
  readonly providerId: ProviderId;
  invoke(
    request: ProviderInvocationRequest<TInput>,
  ): Promise<ProviderInvocationResult<TOutput>>;
}
