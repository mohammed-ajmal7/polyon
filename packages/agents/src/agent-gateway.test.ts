import type { Agent, Model, Provider } from "@polyon/contracts";
import { describe, expect, it } from "vitest";

import { InMemoryAgentRegistry } from "./agent-registry";
import { AgentGateway } from "./agent-gateway";
import { ProviderHealthTracker } from "./provider-health";
import { InMemoryModelRegistry } from "./model-registry";
import { InMemoryProviderRegistry } from "./provider-registry";
import {
  InMemoryProviderAdapterRegistry,
  ModelGateway,
  ProviderInvocationError,
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
  it("supports typed text model invocations through the agent boundary", async () => {
    const gateway = createGateway({
      providerId: "provider-1",
      async invoke({ input }) {
        const request = input as {
          messages: readonly { content: string }[];
        };

        return {
          output: {
            content: request.messages[request.messages.length - 1]?.content ?? "",
            finishReason: "STOP",
          },
        };
      },
    });

    await expect(
      gateway.invokeText({
        agentId: "agent-1",
        requiredCapabilityIds: ["research"],
        request: {
          messages: [
            { role: "SYSTEM", content: "You are POLYON." },
            { role: "USER", content: "Run the task." },
          ],
          temperature: 0.2,
          maxOutputTokens: 200,
        },
      }),
    ).resolves.toEqual({
      agentId: "agent-1",
      modelId: "model-1",
      providerId: "provider-1",
      source: "PREFERRED",
      output: {
        content: "Run the task.",
        finishReason: "STOP",
      },
    });
  });

  it("passes model invocation reliability options through the agent boundary", async () => {
    let timeoutMs: number | undefined;
    let retries: number | undefined;

    const gateway = createGateway({
      providerId: "provider-1",
      async invoke() {
        return { output: "ok" };
      },
    });

    const modelGateway = (
      gateway as unknown as {
        dependencies: { modelGateway: { invoke: typeof ModelGateway.prototype.invoke } };
      }
    ).dependencies.modelGateway;
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

  it("records provider failure and reroutes to a healthy fallback provider", async () => {
    const agents = new InMemoryAgentRegistry();
    const models = new InMemoryModelRegistry();
    const providers = new InMemoryProviderRegistry();
    const adapters = new InMemoryProviderAdapterRegistry();

    agents.register({
      ...agent,
      preferredModelId: "model-preferred",
      fallbackModelIds: ["model-fallback"],
    });

    models.register({
      ...model,
      id: "model-preferred",
      providerId: "provider-primary",
    });
    models.register({
      ...model,
      id: "model-fallback",
      providerId: "provider-fallback",
    });

    providers.register({
      id: "provider-primary",
      name: "Primary",
      kind: "HOSTED_MODEL",
      enabled: true,
    });
    providers.register({
      id: "provider-fallback",
      name: "Fallback",
      kind: "LOCAL_MODEL",
      enabled: true,
    });

    let primaryCalls = 0;
    let fallbackCalls = 0;

    adapters.register({
      providerId: "provider-primary",
      async invoke() {
        primaryCalls += 1;
        throw new ProviderInvocationError(
          "UNAVAILABLE",
          "provider-primary",
          "model-preferred",
          "primary unavailable",
          true,
        );
      },
    });
    adapters.register({
      providerId: "provider-fallback",
      async invoke() {
        fallbackCalls += 1;
        return { output: "fallback success" };
      },
    });

    const providerHealth = new ProviderHealthTracker();
    const gateway = new AgentGateway({
      agents,
      models,
      providers,
      modelGateway: new ModelGateway({ models, providers, adapters }),
      providerHealth,
    });

    await expect(
      gateway.invoke({
        agentId: "agent-1",
        requiredCapabilityIds: ["research"],
        input: "hello",
      }),
    ).resolves.toMatchObject({
      modelId: "model-fallback",
      providerId: "provider-fallback",
      source: "FALLBACK",
      output: "fallback success",
    });

    expect(primaryCalls).toBe(1);
    expect(fallbackCalls).toBe(1);
    expect(providerHealth.get("provider-primary")).toMatchObject({
      status: "degraded",
      consecutiveFailures: 1,
      lastFailureKind: "UNAVAILABLE",
    });
    expect(providerHealth.get("provider-fallback").status).toBe("healthy");
  });
});
