export type IntegrationKind = "GOOGLE_DRIVE" | "TELEGRAM" | "EMAIL";

export type IntegrationId = string;

export type IntegrationSideEffectClass = "READ_ONLY" | "IDEMPOTENT" | "NON_IDEMPOTENT";

export interface IntegrationInvocationRequest<TInput = unknown> {
  readonly invocationId: string;
  readonly operation: string;
  readonly input: TInput;
}

export interface IntegrationInvocationResult<TOutput = unknown> {
  readonly output: TOutput;
}

import type { ActionKind } from "@polyon/contracts";

export interface IntegrationAdapter<TInput = unknown, TOutput = unknown> {
  readonly integrationId: IntegrationId;
  readonly kind: IntegrationKind;
  readonly actionKinds: readonly ActionKind[];
  readonly supportedOperations: readonly string[];
  readonly sideEffectClass: IntegrationSideEffectClass;
  invoke(
    request: IntegrationInvocationRequest<TInput>,
  ): Promise<IntegrationInvocationResult<TOutput>>;
}
