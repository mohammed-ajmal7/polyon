import type { Agent, Model, Provider } from "@polyon/contracts";
import { describe, expect, it } from "vitest";

import { InMemoryAgentRegistry } from "./agent-registry";
import { AgentGateway } from "./agent-gateway";
import { InMemoryModelRegistry } from "./model-registry";
import { InMemoryProviderRegistry } from "./provider-registry";
import {
  InMemoryProviderAdapterRegistry,
  ModelGateway,
  type ModelProviderAdapter,
} from "@polyon/providers";

const agent: Agent = {
  id: "agent-1",
  name: "Research",
  role: "Research agent",
  description: "Researches.",
  status: "ACTIVE",
  capabilityIds: ["research"],
  preferredModelId: "model-1",
  fallbackModelIds: [],
  createdAt: "2026-09-27T01:00:00.000Z",
  updatedAt: "2026-09-27T01:00:00.000Z",
};

const model: Model = {
  id: "model-1",
  providerId: "provider-1",
  name: "Research model",
  kind: "TEXT",
  capabilityIds: ["research"],
  enabled: true,
};

const provider: Provider = {
  id: "provider-1",
  name: "Provider",
  kind: "HOSTED_MODEL",
  enabled: true,
};

function createGateway(adapter: ModelProviderAdapter) {
  const agents = new InMemoryAgentRegistry();
  const models = new InMemoryModelRegistry();
  const providers = new InMemoryProviderRegistry();
  const adapters = new InMemoryProviderAdapterRegistry();

  agents.register(agent);
  models.register(model);
  providers.register(provider);
  adapters.register(adapter);

  const modelGateway = new ModelGateway({ models, providers, adapters });

  return new AgentGateway({
    agents,
    models,
    providers,
    modelGateway,
  });
}

describe("AgentGateway", () => {
  it("passes model invocation reliability options through the agent boundary", async () => {
    let timeoutMs: number | undefined;
    let retries: number | undefined;

    const gateway = createGateway({
      providerId: "provider-1",
      async invoke() {
        return { output: "ok" };
      },
    });

    const modelGateway = (gateway as unknown as { dependencies: { modelGateway: { invoke: typeof ModelGateway.prototype.invoke } } }).dependencies.modelGateway;
    const originalInvoke = modelGateway.invoke.bind(modelGateway);
    modelGateway.invoke = async (...args) => {
      timeoutMs = args[2]?.timeoutMs;
      retries = args[2]?.retries;
      return originalInvoke(...args);
    };

    await expect(
      gateway.invoke({
        agentId: "agent-1",
        requiredCapabilityIds: ["research"],
        input: "hello",
        modelOptions: {
          timeoutMs: 5000,
          retries: 2,
        },
      }),
    ).resolves.toMatchObject({
      output: "ok",
    });

    expect(timeoutMs).toBe(5000);
    expect(retries).toBe(2);
  });

  it("routes an agent invocation through model and provider boundaries", async () => {
    const gateway = createGateway({
      providerId: "provider-1",
      async invoke({ modelId, input }) {
        return { output: modelId + ":" + String(input) };
      },
    });

    await expect(
      gateway.invoke({
        agentId: "agent-1",
        requiredCapabilityIds: ["research"],
        input: "hello",
      }),
    ).resolves.toEqual({
      agentId: "agent-1",
      modelId: "model-1",
      providerId: "provider-1",
      source: "PREFERRED",
      output: "model-1:hello",
    });
  });
});
