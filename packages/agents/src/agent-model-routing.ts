import type { Agent, AgentId, CapabilityId, Model, ModelId, Provider, ProviderId } from "@polyon/contracts";

import { routeAgentModel, type ModelRoutingRequest } from "./model-routing";
import type { AgentRegistry } from "./agent-registry";
import type { ModelRegistry } from "./model-registry";
import type { ProviderRegistry } from "./provider-registry";

export interface ResolveAgentModelInput {
  readonly agentId: AgentId;
  readonly requiredCapabilityIds: readonly CapabilityId[];
}

export interface AgentModelResolution {
  readonly agent: Agent;
  readonly model: Model;
  readonly provider: Provider;
  readonly source: "PREFERRED" | "FALLBACK";
}

export type AgentModelRoutingErrorKind =
  "AGENT_NOT_FOUND" | "AGENT_NOT_ACTIVE" | "AGENT_MISSING_CAPABILITY" | "NO_COMPATIBLE_MODEL";

export class AgentModelRoutingError extends Error {
  readonly kind: AgentModelRoutingErrorKind;
  readonly agentId: AgentId;

  constructor(kind: AgentModelRoutingErrorKind, agentId: AgentId, message: string) {
    super(message);
    this.name = "AgentModelRoutingError";
    this.kind = kind;
    this.agentId = agentId;
  }
}

export function resolveAgentModel(
  input: ResolveAgentModelInput,
  registries: {
    readonly agents: AgentRegistry;
    readonly models: ModelRegistry;
    readonly providers: ProviderRegistry;
  },
): AgentModelResolution {
  const request: ModelRoutingRequest = {
    agentId: input.agentId,
    requiredCapabilityIds: input.requiredCapabilityIds,
  };

  try {
    const result = routeAgentModel(request, registries);

    return {
      agent: result.agent,
      model: result.model,
      provider: result.provider,
      source: result.source,
    };
  } catch (error) {
    if (
      error instanceof Error &&
      (error as Partial<{ kind: AgentModelRoutingErrorKind }>).kind !== undefined
    ) {
      const kind = (error as Error & { kind: AgentModelRoutingErrorKind }).kind;
      throw new AgentModelRoutingError(kind, input.agentId, error.message);
    }

    throw error;
  }
}
