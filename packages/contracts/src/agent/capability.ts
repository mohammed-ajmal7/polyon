export type { CapabilityId } from "./ids";

import type { CapabilityId } from "./ids";

export type CapabilityKind =
  "RESEARCH" | "ANALYSIS" | "CODING" | "CREATIVE" | "COMMUNICATION" | "DELEGATION" | "OTHER";

export interface Capability {
  readonly id: CapabilityId;
  readonly kind: CapabilityKind;
  readonly name: string;
  readonly description: string;
}
