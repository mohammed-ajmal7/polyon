import type { ModelId, ProviderId } from "@polyon/contracts";

export type ProviderInvocationErrorKind =
  | "TIMEOUT"
  | "CANCELLED"
  | "RATE_LIMITED"
  | "UNAVAILABLE"
  | "AUTHENTICATION"
  | "INVALID_REQUEST"
  | "UNKNOWN";

export class ProviderInvocationError extends Error {
  readonly kind: ProviderInvocationErrorKind;
  readonly providerId: ProviderId;
  readonly modelId: ModelId;
  readonly retryable: boolean;

  constructor(
    kind: ProviderInvocationErrorKind,
    providerId: ProviderId,
    modelId: ModelId,
    message: string,
    retryable = false,
  ) {
    super(message);
    this.name = "ProviderInvocationError";
    this.kind = kind;
    this.providerId = providerId;
    this.modelId = modelId;
    this.retryable = retryable;
  }
}

export function normalizeProviderInvocationError(
  error: unknown,
  providerId: ProviderId,
  modelId: ModelId,
): ProviderInvocationError {
  if (error instanceof ProviderInvocationError) {
    return error;
  }

  if (error instanceof Error && error.name === "AbortError") {
    return new ProviderInvocationError(
      "CANCELLED",
      providerId,
      modelId,
      `Provider invocation was cancelled for model: ${modelId}.`,
      false,
    );
  }

  return new ProviderInvocationError(
    "UNKNOWN",
    providerId,
    modelId,
    error instanceof Error ? error.message : "Provider invocation failed.",
    false,
  );
}
