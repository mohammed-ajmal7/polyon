import type { Agent, Model, Provider } from "@polyon/contracts";
import { describe, expect, it } from "vitest";

import { InMemoryAgentRegistry } from "./agent-registry";
import {
  AgentModelRoutingError,
  resolveAgentModel,
} from "./agent-model-routing";
import { InMemoryModelRegistry } from "./model-registry";
import { InMemoryProviderRegistry } from "./provider-registry";

const agent: Agent = {
  id: "agent-1",
  name: "Research Agent",
  role: "Researcher",
  description: "Researches and synthesizes evidence.",
  status: "ACTIVE",
  capabilityIds: ["research", "analysis"],
  preferredModelId: "model-1",
  fallbackModelIds: ["model-2"],
  createdAt: "2026-09-27T01:00:00.000Z",
  updatedAt: "2026-09-27T01:00:00.000Z",
};

const preferredModel: Model = {
  id: "model-1",
  providerId: "provider-1",
  name: "Preferred Model",
  kind: "TEXT",
  capabilityIds: ["research", "analysis"],
  enabled: true,
};

const fallbackModel: Model = {
  id: "model-2",
  providerId: "provider-2",
  name: "Fallback Model",
  kind: "TEXT",
  capabilityIds: ["research", "analysis"],
  enabled: true,
};

const provider1: Provider = {
  id: "provider-1",
  name: "Primary Provider",
  kind: "HOSTED_MODEL",
  enabled: true,
};

const provider2: Provider = {
  id: "provider-2",
  name: "Fallback Provider",
  kind: "LOCAL_MODEL",
  enabled: true,
};

function createRegistries() {
  const agents = new InMemoryAgentRegistry();
  const models = new InMemoryModelRegistry();
  const providers = new InMemoryProviderRegistry();

  agents.register(agent);
  models.register(preferredModel);
  models.register(fallbackModel);
  providers.register(provider1);
  providers.register(provider2);

  return { agents, models, providers };
}

describe("resolveAgentModel", () => {
  it("selects the preferred compatible model", () => {
    const result = resolveAgentModel(
      {
        agentId: "agent-1",
        requiredCapabilityIds: ["research"],
      },
      createRegistries(),
    );

    expect(result.model.id).toBe("model-1");
    expect(result.provider.id).toBe("provider-1");
    expect(result.source).toBe("PREFERRED");
  });

  it("falls back when the preferred model is disabled", () => {
    const registries = createRegistries();
    registries.models.register({
      ...preferredModel,
      id: "model-3",
      enabled: true,
    });

    const result = resolveAgentModel(
      {
        agentId: "agent-1",
        requiredCapabilityIds: ["research"],
      },
      {
        ...registries,
        models: {
          get: (id) => (id === "model-1" ? { ...preferredModel, enabled: false } : registries.models.get(id)),
          list: () => registries.models.list(),
          register: (model) => registries.models.register(model),
        },
      },
    );

    expect(result.model.id).toBe("model-2");
    expect(result.source).toBe("FALLBACK");
  });

  it("falls back when the preferred model lacks a required capability", () => {
    const registries = createRegistries();
    const result = resolveAgentModel(
      {
        agentId: "agent-1",
        requiredCapabilityIds: ["analysis"],
      },
      {
        ...registries,
        models: {
          get: (id) =>
            id === "model-1"
              ? { ...preferredModel, capabilityIds: ["research"] }
              : registries.models.get(id),
          list: () => registries.models.list(),
          register: (model) => registries.models.register(model),
        },
      },
    );

    expect(result.model.id).toBe("model-2");
    expect(result.source).toBe("FALLBACK");
  });

  it("skips a model whose provider is disabled", () => {
    const registries = createRegistries();
    const result = resolveAgentModel(
      {
        agentId: "agent-1",
        requiredCapabilityIds: ["research"],
      },
      {
        ...registries,
        providers: {
          get: (id) => (id === "provider-1" ? { ...provider1, enabled: false } : registries.providers.get(id)),
          list: () => registries.providers.list(),
          register: (provider) => registries.providers.register(provider),
        },
      },
    );

    expect(result.model.id).toBe("model-2");
  });

  it("rejects an unknown agent", () => {
    expect(() =>
      resolveAgentModel(
        {
          agentId: "missing",
          requiredCapabilityIds: ["research"],
        },
        createRegistries(),
      ),
    ).toThrowError(
      new AgentModelRoutingError(
        "AGENT_NOT_FOUND",
        "missing",
        "Agent not found: missing.",
      ),
    );
  });

  it("rejects a non-active agent", () => {
    const registries = createRegistries();

    expect(() =>
      resolveAgentModel(
        {
          agentId: "agent-1",
          requiredCapabilityIds: ["research"],
        },
        {
          ...registries,
          agents: {
            get: () => ({ ...agent, status: "DISABLED" }),
            list: () => registries.agents.list(),
            register: (entry) => registries.agents.register(entry),
          },
        },
      ),
    ).toThrowError(expect.objectContaining({ kind: "AGENT_NOT_ACTIVE" }));
  });

  it("rejects an agent missing a required capability", () => {
    const registries = createRegistries();

    expect(() =>
      resolveAgentModel(
        {
          agentId: "agent-1",
          requiredCapabilityIds: ["coding"],
        },
        createRegistries(),
      ),
    ).toThrowError(expect.objectContaining({ kind: "AGENT_MISSING_CAPABILITY" }));
  });

  it("rejects when no model is compatible", () => {
    const registries = createRegistries();

    expect(() =>
      resolveAgentModel(
        {
          agentId: "agent-1",
          requiredCapabilityIds: ["research"],
        },
        {
          ...registries,
          models: {
            get: () => ({ ...preferredModel, capabilityIds: ["analysis"] }),
            list: () => registries.models.list(),
            register: (model) => registries.models.register(model),
          },
        },
      ),
    ).toThrowError(expect.objectContaining({ kind: "NO_COMPATIBLE_MODEL" }));
  });
});
