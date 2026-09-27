import type { AgentId, CapabilityId, Execution, ModelId, ProviderId } from "@polyon/contracts";

import {
  resolveAgentModel,
  type AgentModelResolution,
  type ResolveAgentModelInput,
} from "./agent-model-routing";
import type { AgentRegistry } from "./agent-registry";
import type { ModelRegistry } from "./model-registry";
import type { ProviderRegistry } from "./provider-registry";

export interface BindExecutionRoutingInput {
  readonly execution: Execution;
  readonly agentId: AgentId;
  readonly requiredCapabilityIds: readonly CapabilityId[];
  readonly boundAt: string;
}

export interface ExecutionRoutingRegistries {
  readonly agents: AgentRegistry;
  readonly models: ModelRegistry;
  readonly providers: ProviderRegistry;
}

export interface BoundExecutionRouting {
  readonly execution: Execution;
  readonly resolution: AgentModelResolution;
  readonly modelId: ModelId;
  readonly providerId: ProviderId;
}

export function bindExecutionRouting(
  input: BindExecutionRoutingInput,
  registries: ExecutionRoutingRegistries,
): BoundExecutionRouting {
  const resolveInput: ResolveAgentModelInput = {
    agentId: input.agentId,
    requiredCapabilityIds: input.requiredCapabilityIds,
  };

  const resolution = resolveAgentModel(resolveInput, registries);

  return {
    execution: {
      ...input.execution,
      agentId: resolution.agent.id,
      modelId: resolution.model.id,
      providerId: resolution.provider.id,
      updatedAt: input.boundAt,
    },
    resolution,
    modelId: resolution.model.id,
    providerId: resolution.provider.id,
  };
}
