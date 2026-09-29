import type { ModelId, ProviderId } from "@polyon/contracts";
import type { ProviderInvocationErrorKind } from "./provider-errors";

export interface ModelInvocationTelemetryRecord {
  readonly providerId: ProviderId;
  readonly modelId: ModelId;
  readonly runId?: string;
  readonly agentId?: string;
  readonly attempt: number;
  readonly status: "SUCCEEDED" | "FAILED";
  readonly estimatedTokens?: number;
  readonly actualTokens?: number;
  readonly latencyMs: number;
  readonly costClass: "free" | "paid" | "unknown";
  readonly errorKind?: ProviderInvocationErrorKind;
  readonly recordedAt: string;
}

export interface ModelInvocationTelemetrySink {
  record(record: ModelInvocationTelemetryRecord): void | Promise<void>;
}