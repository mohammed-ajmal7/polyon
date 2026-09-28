export type { ModelId } from "./ids";

import type { CapabilityId, ModelId, ProviderId } from "./ids";

export type ModelKind =
  "TEXT" | "MULTIMODAL" | "IMAGE" | "AUDIO" | "VIDEO" | "EMBEDDING" | "RERANKER" | "OTHER";

export type ModelPrivacyClass = "local" | "cloud";
export type ModelCostClass = "free" | "paid";

export interface Model {
  readonly id: ModelId;
  readonly providerId: ProviderId;
  readonly name: string;
  readonly kind: ModelKind;
  readonly capabilityIds: readonly CapabilityId[];
  readonly contextWindow?: number;
  readonly supportsTools?: boolean;
  readonly supportsVision?: boolean;
  readonly privacyClass?: ModelPrivacyClass;
  readonly costClass?: ModelCostClass;
  readonly enabled: boolean;
}
