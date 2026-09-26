import type { AgentId, CapabilityId, ModelId } from "./ids";

export type AgentStatus = "DRAFT" | "ACTIVE" | "DISABLED";

export interface Agent {
  readonly id: AgentId;
  readonly name: string;
  readonly role: string;
  readonly description: string;
  readonly status: AgentStatus;

  readonly capabilityIds: readonly CapabilityId[];

  readonly preferredModelId?: ModelId;
  readonly fallbackModelIds: readonly ModelId[];

  readonly createdAt: string;
  readonly updatedAt: string;
}
