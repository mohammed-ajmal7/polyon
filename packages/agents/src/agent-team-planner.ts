import type {
  Agent,
  AgentId,
  CapabilityId,
  Model,
  Provider,
  ProviderId,
} from "@polyon/contracts";

import {
  routeAgentModel,
  type ModelRoutingRequest,
  type ProviderHealth,
} from "./model-routing";
import type { AgentRegistry } from "./agent-registry";
import type { ModelRegistry } from "./model-registry";
import type { ProviderRegistry } from "./provider-registry";

export interface AgentTeamPlanningRequest {
  readonly requiredCapabilityIds: readonly CapabilityId[];
  readonly requiredModelCapabilityIds?: readonly CapabilityId[];
  readonly preferredRoles?: readonly string[];
  readonly maximumAgents?: number;
  readonly minimumAgents?: number;
  readonly privacyClass?: "local" | "cloud";
  readonly allowPaidModels?: boolean;
  readonly minimumContextWindow?: number;
  readonly requireTools?: boolean;
  readonly providerHealth?: Readonly<Record<ProviderId, ProviderHealth>>;
  readonly excludedAgentIds?: readonly AgentId[];
  readonly allowedAgentIds?: readonly AgentId[];
  readonly preferProviderDiversity?: boolean;
}

export interface AgentTeamMember {
  readonly agent: Agent;
  readonly model: Model;
  readonly provider: Provider;
  readonly source: "PREFERRED" | "FALLBACK";
  readonly score: number;
  readonly rationale: string;
}

export interface AgentTeamPlan {
  readonly members: readonly AgentTeamMember[];
  readonly requiredCapabilityIds: readonly CapabilityId[];
}

export type AgentTeamPlannerErrorKind =
  | "INVALID_BOUNDS"
  | "NO_ELIGIBLE_AGENTS"
  | "INSUFFICIENT_AGENTS";

export class AgentTeamPlannerError extends Error {
  readonly kind: AgentTeamPlannerErrorKind;

  constructor(kind: AgentTeamPlannerErrorKind, message: string) {
    super(message);
    this.name = "AgentTeamPlannerError";
    this.kind = kind;
  }
}

function roleMatches(agent: Agent, preferredRoles: readonly string[]): boolean {
  if (preferredRoles.length === 0) return false;
  const role = agent.role.trim().toLowerCase();
  const roleId = agent.roleId?.trim().toLowerCase();
  return preferredRoles.some((preferred) => {
    const normalized = preferred.trim().toLowerCase();
    return role === normalized || roleId === normalized;
  });
}

function validateBounds(minimumAgents: number, maximumAgents: number): void {
  if (
    !Number.isInteger(minimumAgents) ||
    !Number.isInteger(maximumAgents) ||
    minimumAgents < 1 ||
    maximumAgents < minimumAgents ||
    maximumAgents > 8
  ) {
    throw new AgentTeamPlannerError(
      "INVALID_BOUNDS",
      "Agent team bounds must be integers with 1 <= minimumAgents <= maximumAgents <= 8.",
    );
  }
}

export function planAgentTeam(
  request: AgentTeamPlanningRequest,
  registries: {
    readonly agents: AgentRegistry;
    readonly models: ModelRegistry;
    readonly providers: ProviderRegistry;
  },
): AgentTeamPlan {
  const minimumAgents = request.minimumAgents ?? 2;
  const maximumAgents = request.maximumAgents ?? 4;
  validateBounds(minimumAgents, maximumAgents);

  const excluded = new Set(request.excludedAgentIds ?? []);
  const allowed =
    request.allowedAgentIds === undefined ? undefined : new Set(request.allowedAgentIds);
  const preferredRoles = request.preferredRoles ?? [];

  const ranked: AgentTeamMember[] = [];

  for (const agent of registries.agents.list()) {
    if (agent.status !== "ACTIVE") continue;
    if (excluded.has(agent.id)) continue;
    if (allowed !== undefined && !allowed.has(agent.id)) continue;

    let routing;
    try {
      const routingRequest: ModelRoutingRequest = {
        agentId: agent.id,
        requiredCapabilityIds: request.requiredCapabilityIds,
        ...(request.requiredModelCapabilityIds === undefined
          ? {}
          : { requiredModelCapabilityIds: request.requiredModelCapabilityIds }),
        ...(request.privacyClass === undefined
          ? {}
          : { privacyClass: request.privacyClass }),
        ...(request.allowPaidModels === undefined
          ? {}
          : { allowPaidModels: request.allowPaidModels }),
        ...(request.minimumContextWindow === undefined
          ? {}
          : { minimumContextWindow: request.minimumContextWindow }),
        ...(request.requireTools === undefined ? {} : { requireTools: request.requireTools }),
        ...(request.providerHealth === undefined
          ? {}
          : { providerHealth: request.providerHealth }),
      };
      routing = routeAgentModel(routingRequest, registries);
    } catch {
      continue;
    }

    let score = routing.score;
    const preferredRole = roleMatches(agent, preferredRoles);

    if (preferredRoles.length > 0) {
      score += preferredRole ? 0 : 20;
    }

    if (
      request.preferProviderDiversity &&
      ranked.some((member) => member.provider.id === routing.provider.id)
    ) {
      score += 15;
    }

    const rationale = [
      preferredRole ? "preferred role" : preferredRoles.length > 0 ? "eligible role" : "eligible agent",
      routing.source === "PREFERRED" ? "preferred model" : "fallback model",
      routing.providerHealth === "healthy"
        ? "healthy provider"
        : `${routing.providerHealth} provider`,
    ].join("; ");

    ranked.push({
      agent,
      model: routing.model,
      provider: routing.provider,
      source: routing.source,
      score,
      rationale,
    });
  }

  ranked.sort((a, b) => {
    if (a.score !== b.score) return a.score - b.score;
    return a.agent.id.localeCompare(b.agent.id);
  });

  const members: AgentTeamMember[] = [];
  const usedProviders = new Set<ProviderId>();

  for (const candidate of ranked) {
    if (members.length >= maximumAgents) break;

    if (
      request.preferProviderDiversity &&
      usedProviders.has(candidate.provider.id) &&
      ranked.some(
        (other) =>
          other.agent.id !== candidate.agent.id &&
          !usedProviders.has(other.provider.id) &&
          other.score <= candidate.score + 15,
      )
    ) {
      continue;
    }

    members.push(candidate);
    usedProviders.add(candidate.provider.id);
  }

  if (ranked.length === 0) {
    throw new AgentTeamPlannerError(
      "NO_ELIGIBLE_AGENTS",
      "No active agents can satisfy the requested team constraints.",
    );
  }

  if (members.length < minimumAgents) {
    throw new AgentTeamPlannerError(
      "INSUFFICIENT_AGENTS",
      `Unable to form the requested team: found ${members.length}, required at least ${minimumAgents}.`,
    );
  }

  return {
    members,
    requiredCapabilityIds: [...request.requiredCapabilityIds],
  };
}
