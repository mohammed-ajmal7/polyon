import type {
  Agent,
  AgentId,
  CapabilityId,
  Model,
  ModelId,
  Provider,
  ProviderId,
  ModelCostClass,
  ModelPrivacyClass,
} from "@polyon/contracts";

import type { AgentRegistry } from "./agent-registry";
import type { ModelRegistry } from "./model-registry";
import type { ProviderRegistry } from "./provider-registry";

export type ProviderHealth = "healthy" | "degraded" | "quota_limited" | "unavailable" | "misconfigured";

export interface ModelRoutingRequest {
  readonly agentId: AgentId;
  readonly requiredCapabilityIds: readonly CapabilityId[];
  readonly privacyClass?: ModelPrivacyClass;
  readonly allowPaidModels?: boolean;
  readonly minimumContextWindow?: number;
  readonly requireTools?: boolean;
  readonly providerHealth?: Readonly<Record<ProviderId, ProviderHealth>>;
}

export interface RoutedAgentModel {
  readonly agent: Agent;
  readonly model: Model;
  readonly provider: Provider;
  readonly source: "PREFERRED" | "FALLBACK";
  readonly score: number;
  readonly providerHealth: ProviderHealth;
}

export type ModelRoutingErrorKind =
  | "AGENT_NOT_FOUND"
  | "AGENT_NOT_ACTIVE"
  | "AGENT_MISSING_CAPABILITY"
  | "NO_COMPATIBLE_MODEL";

export class ModelRoutingError extends Error {
  readonly kind: ModelRoutingErrorKind;
  readonly agentId: AgentId;

  constructor(kind: ModelRoutingErrorKind, agentId: AgentId, message: string) {
    super(message);
    this.name = "ModelRoutingError";
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
): readonly { id: ModelId; source: "PREFERRED" | "FALLBACK" }[] {
  const candidates: { id: ModelId; source: "PREFERRED" | "FALLBACK" }[] = [];

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

function providerHealthOf(
  provider: Provider,
  providerHealth: Readonly<Record<ProviderId, ProviderHealth>> | undefined,
): ProviderHealth {
  return providerHealth?.[provider.id] ?? "healthy";
}

function effectiveCostClass(model: Model, provider: Provider): ModelCostClass | undefined {
  return model.costClass ?? (provider.kind === "LOCAL_MODEL" ? "free" : undefined);
}

function passesPrivacy(
  model: Model,
  provider: Provider,
  requiredPrivacyClass: ModelPrivacyClass | undefined,
): boolean {
  if (requiredPrivacyClass === undefined) {
    return true;
  }

  const actualPrivacy = model.privacyClass ?? (provider.kind === "LOCAL_MODEL" ? "local" : "cloud");
  return actualPrivacy === requiredPrivacyClass;
}

function passesCost(
  model: Model,
  provider: Provider,
  allowPaidModels: boolean | undefined,
): boolean {
  if (allowPaidModels !== false) {
    return true;
  }

  return effectiveCostClass(model, provider) === "free";
}

function passesCapabilities(
  model: Model,
  requiredCapabilityIds: readonly CapabilityId[],
  request: ModelRoutingRequest,
): boolean {
  if (!hasCapabilities(model.capabilityIds, requiredCapabilityIds)) {
    return false;
  }

  if (
    request.minimumContextWindow !== undefined &&
    (model.contextWindow === undefined || model.contextWindow < request.minimumContextWindow)
  ) {
    return false;
  }

  if (request.requireTools === true && model.supportsTools !== true) {
    return false;
  }

  return true;
}

function sourcePenalty(source: "PREFERRED" | "FALLBACK"): number {
  return source === "PREFERRED" ? 0 : 10;
}

function healthPenalty(health: ProviderHealth): number {
  switch (health) {
    case "healthy":
      return 0;
    case "degraded":
      return 25;
    case "quota_limited":
      return 100;
    case "unavailable":
    case "misconfigured":
      return Number.POSITIVE_INFINITY;
  }
}

function candidateScore(source: "PREFERRED" | "FALLBACK", health: ProviderHealth): number {
  return sourcePenalty(source) + healthPenalty(health);
}

export function routeAgentModel(
  request: ModelRoutingRequest,
  registries: {
    readonly agents: AgentRegistry;
    readonly models: ModelRegistry;
    readonly providers: ProviderRegistry;
  },
): RoutedAgentModel {
  const agent = registries.agents.get(request.agentId);

  if (agent === undefined) {
    throw new ModelRoutingError(
      "AGENT_NOT_FOUND",
      request.agentId,
      `Agent not found: ${request.agentId}.`,
    );
  }

  if (agent.status !== "ACTIVE") {
    throw new ModelRoutingError(
      "AGENT_NOT_ACTIVE",
      request.agentId,
      `Agent is not active: ${request.agentId}.`,
    );
  }

  if (!hasCapabilities(agent.capabilityIds, request.requiredCapabilityIds)) {
    throw new ModelRoutingError(
      "AGENT_MISSING_CAPABILITY",
      request.agentId,
      `Agent does not provide all required capabilities: ${request.requiredCapabilityIds.join(", ")}.`,
    );
  }

  let best: RoutedAgentModel | undefined;

  for (const candidate of candidateModelIds(agent)) {
    const model = registries.models.get(candidate.id);

    if (model === undefined || !model.enabled) {
      continue;
    }

    const provider = registries.providers.get(model.providerId);

    if (provider === undefined || !provider.enabled) {
      continue;
    }

    const health = providerHealthOf(provider, request.providerHealth);

    if (
      !passesPrivacy(model, provider, request.privacyClass) ||
      !passesCost(model, provider, request.allowPaidModels) ||
      !passesCapabilities(model, request.requiredCapabilityIds, request)
    ) {
      continue;
    }

    const score = candidateScore(candidate.source, health);

    if (!Number.isFinite(score)) {
      continue;
    }

    const routed: RoutedAgentModel = {
      agent,
      model,
      provider,
      source: candidate.source,
      score,
      providerHealth: health,
    };

    if (best === undefined || routed.score < best.score) {
      best = routed;
    }
  }

  if (best === undefined) {
    throw new ModelRoutingError(
      "NO_COMPATIBLE_MODEL",
      request.agentId,
      `No compatible enabled model is available for agent: ${request.agentId}.`,
    );
  }

  return best;
}
