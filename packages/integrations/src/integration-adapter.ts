export type IntegrationKind = "GOOGLE_DRIVE" | "TELEGRAM" | "EMAIL";

export type IntegrationId = string;

export interface IntegrationInvocationRequest<TInput = unknown> {
  readonly operation: string;
  readonly input: TInput;
}

export interface IntegrationInvocationResult<TOutput = unknown> {
  readonly output: TOutput;
}

export interface IntegrationAdapter<TInput = unknown, TOutput = unknown> {
  readonly integrationId: IntegrationId;
  readonly kind: IntegrationKind;
  invoke(
    request: IntegrationInvocationRequest<TInput>,
  ): Promise<IntegrationInvocationResult<TOutput>>;
}
