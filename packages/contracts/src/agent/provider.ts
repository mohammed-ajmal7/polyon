export type { ProviderId } from "./ids";

import type { ProviderId } from "./ids";

export type ProviderKind = "HOSTED_MODEL" | "LOCAL_MODEL" | "CLI_AGENT" | "REMOTE_AGENT" | "OTHER";

export interface Provider {
  readonly id: ProviderId;
  readonly name: string;
  readonly kind: ProviderKind;
  readonly enabled: boolean;
}
