export type IntegrationKind = "GOOGLE_DRIVE" | "TELEGRAM" | "EMAIL";

export type IntegrationId = string;

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
  invoke(
    request: IntegrationInvocationRequest<TInput>,
  ): Promise<IntegrationInvocationResult<TOutput>>;
}
