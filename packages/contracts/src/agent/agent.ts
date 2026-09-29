import type { AgentId, CapabilityId, ModelId } from "./ids";
import type { BuiltInAgentRoleId } from "./roles";

export type AgentStatus = "DRAFT" | "ACTIVE" | "DISABLED";

export interface Agent {
  readonly id: AgentId;
  readonly name: string;
  readonly role: string;
  readonly roleId?: BuiltInAgentRoleId;
  readonly description: string;
  readonly status: AgentStatus;

  readonly capabilityIds: readonly CapabilityId[];

  readonly preferredModelId?: ModelId;
  readonly fallbackModelIds: readonly ModelId[];
  readonly allowedToolIds?: readonly string[];
  readonly maxRounds?: number;
  readonly maxTokens?: number;

  readonly createdAt: string;
  readonly updatedAt: string;
}
