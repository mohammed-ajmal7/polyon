import type { Agent, AgentId } from "@polyon/contracts";

export type AgentRegistryErrorKind = "AGENT_ALREADY_EXISTS";

export class AgentRegistryError extends Error {
  readonly kind: AgentRegistryErrorKind;
  readonly agentId: AgentId;

  constructor(kind: AgentRegistryErrorKind, agentId: AgentId) {
    super(`Agent already exists in registry: ${agentId}.`);
    this.name = "AgentRegistryError";
    this.kind = kind;
    this.agentId = agentId;
  }
}

export interface AgentRegistry {
  register(agent: Agent): void;
  get(agentId: AgentId): Agent | undefined;
  list(): readonly Agent[];
}

function cloneAgent(agent: Agent): Agent {
  return {
    ...agent,
    capabilityIds: [...agent.capabilityIds],
    fallbackModelIds: [...agent.fallbackModelIds],
    ...(agent.allowedToolIds === undefined ? {} : { allowedToolIds: [...agent.allowedToolIds] }),
  };
}

export class InMemoryAgentRegistry implements AgentRegistry {
  private readonly agents = new Map<AgentId, Agent>();

  register(agent: Agent): void {
    if (this.agents.has(agent.id)) {
      throw new AgentRegistryError("AGENT_ALREADY_EXISTS", agent.id);
    }

    this.agents.set(agent.id, cloneAgent(agent));
  }

  get(agentId: AgentId): Agent | undefined {
    const agent = this.agents.get(agentId);

    return agent === undefined ? undefined : cloneAgent(agent);
  }

  list(): readonly Agent[] {
    return [...this.agents.values()].map(cloneAgent);
  }
}
