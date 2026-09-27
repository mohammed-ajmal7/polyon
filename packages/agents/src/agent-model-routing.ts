import type { Agent, AgentId, CapabilityId, Model, Provider } from "@polyon/contracts";

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

function hasCapabilities(
  availableCapabilityIds: readonly CapabilityId[],
  requiredCapabilityIds: readonly CapabilityId[],
): boolean {
  return requiredCapabilityIds.every((required) => availableCapabilityIds.includes(required));
}

function candidateModelIds(
  agent: Agent,
): readonly { id: string; source: "PREFERRED" | "FALLBACK" }[] {
  const candidates: { id: string; source: "PREFERRED" | "FALLBACK" }[] = [];

  if (agent.preferredModelId !== undefined) {
    candidates.push({ id: agent.preferredModelId, source: "PREFERRED" });
  }

  for (const modelId of agent.fallbackModelIds) {
    if (!candidates.some((candidate) => candidate.id === modelId)) {
      candidates.push({ id: modelId, source: "FALLBACK" });
    }
  }

  return candidates;
}

export function resolveAgentModel(
  input: ResolveAgentModelInput,
  registries: {
    readonly agents: AgentRegistry;
    readonly models: ModelRegistry;
    readonly providers: ProviderRegistry;
  },
): AgentModelResolution {
  const agent = registries.agents.get(input.agentId);

  if (agent === undefined) {
    throw new AgentModelRoutingError(
      "AGENT_NOT_FOUND",
      input.agentId,
      `Agent not found: ${input.agentId}.`,
    );
  }

  if (agent.status !== "ACTIVE") {
    throw new AgentModelRoutingError(
      "AGENT_NOT_ACTIVE",
      input.agentId,
      `Agent is not active: ${input.agentId}.`,
    );
  }

  if (!hasCapabilities(agent.capabilityIds, input.requiredCapabilityIds)) {
    throw new AgentModelRoutingError(
      "AGENT_MISSING_CAPABILITY",
      input.agentId,
      `Agent does not provide all required capabilities: ${input.requiredCapabilityIds.join(", ")}.`,
    );
  }

  for (const candidate of candidateModelIds(agent)) {
    const model = registries.models.get(candidate.id);

    if (model === undefined) {
      continue;
    }

    if (!model.enabled) {
      continue;
    }

    if (!hasCapabilities(model.capabilityIds, input.requiredCapabilityIds)) {
      continue;
    }

    const provider = registries.providers.get(model.providerId);

    if (provider === undefined || !provider.enabled) {
      continue;
    }

    return {
      agent,
      model,
      provider,
      source: candidate.source,
    };
  }

  throw new AgentModelRoutingError(
    "NO_COMPATIBLE_MODEL",
    input.agentId,
    `No compatible enabled model is available for agent: ${input.agentId}.`,
  );
}
