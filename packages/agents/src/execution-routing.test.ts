import type { Agent, Execution, Model, Provider } from "@polyon/contracts";
import { describe, expect, it } from "vitest";

import { InMemoryAgentRegistry } from "./agent-registry";
import { bindExecutionRouting } from "./execution-routing";
import { InMemoryModelRegistry } from "./model-registry";
import { InMemoryProviderRegistry } from "./provider-registry";

const execution: Execution = {
  id: "execution-1",
  missionId: "mission-1",
  taskId: "task-1",
  actorId: "user-1",
  attempt: 1,
  status: "PENDING",
  createdAt: "2026-09-27T01:00:00.000Z",
  updatedAt: "2026-09-27T01:00:00.000Z",
};

const agent: Agent = {
  id: "agent-1",
  name: "Coder",
  role: "Coding agent",
  description: "Writes code.",
  status: "ACTIVE",
  capabilityIds: ["coding"],
  preferredModelId: "model-1",
  fallbackModelIds: [],
  createdAt: "2026-09-27T01:00:00.000Z",
  updatedAt: "2026-09-27T01:00:00.000Z",
};

const model: Model = {
  id: "model-1",
  providerId: "provider-1",
  name: "Coding model",
  kind: "TEXT",
  capabilityIds: ["coding"],
  enabled: true,
};

const provider: Provider = {
  id: "provider-1",
  name: "Provider",
  kind: "HOSTED_MODEL",
  enabled: true,
};

function createRegistries() {
  const agents = new InMemoryAgentRegistry();
  const models = new InMemoryModelRegistry();
  const providers = new InMemoryProviderRegistry();

  agents.register(agent);
  models.register(model);
  providers.register(provider);

  return { agents, models, providers };
}

describe("bindExecutionRouting", () => {
  it("binds selected agent, model, and provider metadata", () => {
    const result = bindExecutionRouting(
      {
        execution,
        agentId: "agent-1",
        requiredCapabilityIds: ["coding"],
        boundAt: "2026-09-27T01:02:00.000Z",
      },
      createRegistries(),
    );

    expect(result.execution).toEqual({
      ...execution,
      agentId: "agent-1",
      modelId: "model-1",
      providerId: "provider-1",
      updatedAt: "2026-09-27T01:02:00.000Z",
    });
    expect(result.resolution.source).toBe("PREFERRED");
  });

  it("does not mutate the original execution", () => {
    const before = structuredClone(execution);

    bindExecutionRouting(
      {
        execution,
        agentId: "agent-1",
        requiredCapabilityIds: ["coding"],
        boundAt: "2026-09-27T01:02:00.000Z",
      },
      createRegistries(),
    );

    expect(execution).toEqual(before);
  });
});
