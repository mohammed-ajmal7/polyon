import type { Agent, Model, Provider } from "@polyon/contracts";
import { describe, expect, it } from "vitest";

import { InMemoryAgentRegistry } from "./agent-registry";
import { ModelRoutingError, routeAgentModel } from "./model-routing";
import { InMemoryModelRegistry } from "./model-registry";
import { InMemoryProviderRegistry } from "./provider-registry";

const agent: Agent = {
  id: "agent-1",
  name: "General Agent",
  role: "Generalist",
  description: "Routes work to compatible models.",
  status: "ACTIVE",
  capabilityIds: ["research"],
  preferredModelId: "model-cloud",
  fallbackModelIds: ["model-local", "model-degraded"],
  createdAt: "2026-09-29T00:00:00.000Z",
  updatedAt: "2026-09-29T00:00:00.000Z",
};

const cloudModel: Model = {
  id: "model-cloud",
  providerId: "cloud",
  name: "Cloud",
  kind: "TEXT",
  capabilityIds: ["research"],
  contextWindow: 128000,
  supportsTools: true,
  privacyClass: "cloud",
  costClass: "paid",
  enabled: true,
};

const localModel: Model = {
  id: "model-local",
  providerId: "local",
  name: "Local",
  kind: "TEXT",
  capabilityIds: ["research"],
  contextWindow: 32768,
  supportsTools: true,
  privacyClass: "local",
  costClass: "free",
  enabled: true,
};

const degradedModel: Model = {
  ...localModel,
  id: "model-degraded",
  providerId: "degraded",
  name: "Degraded Local",
};

const cloud: Provider = {
  id: "cloud",
  name: "Cloud Provider",
  kind: "HOSTED_MODEL",
  enabled: true,
};

const local: Provider = {
  id: "local",
  name: "Local Provider",
  kind: "LOCAL_MODEL",
  enabled: true,
};

const degraded: Provider = {
  id: "degraded",
  name: "Degraded Provider",
  kind: "LOCAL_MODEL",
  enabled: true,
};

function createRegistries() {
  const agents = new InMemoryAgentRegistry();
  const models = new InMemoryModelRegistry();
  const providers = new InMemoryProviderRegistry();

  agents.register(agent);
  models.register(cloudModel);
  models.register(localModel);
  models.register(degradedModel);
  providers.register(cloud);
  providers.register(local);
  providers.register(degraded);

  return { agents, models, providers };
}

describe("routeAgentModel", () => {
  it("keeps the preferred model when it satisfies the routing constraints", () => {
    const result = routeAgentModel(
      {
        agentId: agent.id,
        requiredCapabilityIds: ["research"],
      },
      createRegistries(),
    );

    expect(result.model.id).toBe("model-cloud");
    expect(result.source).toBe("PREFERRED");
    expect(result.providerHealth).toBe("healthy");
  });

  it("enforces zero-cost routing by excluding paid models", () => {
    const result = routeAgentModel(
      {
        agentId: agent.id,
        requiredCapabilityIds: ["research"],
        allowPaidModels: false,
      },
      createRegistries(),
    );

    expect(result.model.id).toBe("model-local");
    expect(result.source).toBe("FALLBACK");
    expect(result.model.costClass).toBe("free");
  });

  it("enforces local privacy routing", () => {
    const result = routeAgentModel(
      {
        agentId: agent.id,
        requiredCapabilityIds: ["research"],
        privacyClass: "local",
      },
      createRegistries(),
    );

    expect(result.model.id).toBe("model-local");
    expect(result.provider.kind).toBe("LOCAL_MODEL");
  });

  it("filters models that cannot satisfy context or tool requirements", () => {
    const result = routeAgentModel(
      {
        agentId: agent.id,
        requiredCapabilityIds: ["research"],
        minimumContextWindow: 64000,
        requireTools: true,
      },
      createRegistries(),
    );

    expect(result.model.id).toBe("model-cloud");
  });

  it("prefers a healthy fallback over a degraded preferred provider", () => {
    const result = routeAgentModel(
      {
        agentId: agent.id,
        requiredCapabilityIds: ["research"],
        providerHealth: {
          cloud: "degraded",
          local: "healthy",
          degraded: "degraded",
        },
      },
      createRegistries(),
    );

    expect(result.model.id).toBe("model-local");
    expect(result.providerHealth).toBe("healthy");
    expect(result.score).toBeLessThan(25);
  });

  it("skips quota-limited and unavailable providers", () => {
    const result = routeAgentModel(
      {
        agentId: agent.id,
        requiredCapabilityIds: ["research"],
        providerHealth: {
          cloud: "quota_limited",
          local: "unavailable",
          degraded: "healthy",
        },
      },
      createRegistries(),
    );

    expect(result.model.id).toBe("model-degraded");
  });

  it("fails closed when zero-cost routing has no free compatible model", () => {
    const registries = createRegistries();
    registries.models.register({
      id: "model-paid-fallback",
      providerId: "cloud",
      name: "Paid Fallback",
      kind: "TEXT",
      capabilityIds: ["research"],
      enabled: true,
      costClass: "paid",
    });

    expect(() =>
      routeAgentModel(
        {
          agentId: agent.id,
          requiredCapabilityIds: ["research"],
          allowPaidModels: false,
          privacyClass: "cloud",
          providerHealth: {
            cloud: "healthy",
            local: "healthy",
            degraded: "healthy",
          },
        },
        registries,
      ),
    ).toThrowError(expect.objectContaining({ kind: "NO_COMPATIBLE_MODEL" }));
  });

  it("rejects unknown agents using the routing error contract", () => {
    expect(() =>
      routeAgentModel(
        {
          agentId: "missing",
          requiredCapabilityIds: [],
        },
        createRegistries(),
      ),
    ).toThrowError(
      new ModelRoutingError("AGENT_NOT_FOUND", "missing", "Agent not found: missing."),
    );
  });
});
