import type { Agent, Model, Provider } from "@polyon/contracts";
import { describe, expect, it } from "vitest";

import { InMemoryAgentRegistry } from "./agent-registry";
import { routeAgentModel } from "./model-routing";
import { InMemoryModelRegistry } from "./model-registry";
import { InMemoryProviderRegistry } from "./provider-registry";

const agent: Agent = {
  id: "agent",
  name: "Vision analyst",
  role: "Analyst",
  description: "Analyzes visual and textual material.",
  capabilityIds: ["ai.chat", "ai.reasoning"],
  status: "ACTIVE",
  preferredModelId: "text-model",
  fallbackModelIds: ["vision-model"],
  createdAt: "2026-09-29T00:00:00.000Z",
  updatedAt: "2026-09-29T00:00:00.000Z",
};

const textModel: Model = {
  id: "text-model",
  providerId: "local",
  name: "Text",
  kind: "TEXT",
  capabilityIds: ["ai.chat", "ai.reasoning"],
  enabled: true,
};

const visionModel: Model = {
  id: "vision-model",
  providerId: "local",
  name: "Vision",
  kind: "MULTIMODAL",
  capabilityIds: ["ai.chat", "ai.reasoning", "ai.vision"],
  supportsVision: true,
  enabled: true,
};

const provider: Provider = {
  id: "local",
  name: "Local",
  kind: "LOCAL_MODEL",
  enabled: true,
};

function registries() {
  const agents = new InMemoryAgentRegistry();
  const models = new InMemoryModelRegistry();
  const providers = new InMemoryProviderRegistry();

  agents.register(agent);
  models.register(textModel);
  models.register(visionModel);
  providers.register(provider);

  return { agents, models, providers };
}

describe("model-specific routing capabilities", () => {
  it("selects a fallback that satisfies a model-only capability requirement", () => {
    const result = routeAgentModel(
      {
        agentId: agent.id,
        requiredCapabilityIds: ["ai.chat", "ai.reasoning"],
        requiredModelCapabilityIds: ["ai.chat", "ai.vision"],
      },
      registries(),
    );

    expect(result.model.id).toBe("vision-model");
    expect(result.source).toBe("FALLBACK");
  });

  it("still enforces the agent capability contract separately", () => {
    expect(() =>
      routeAgentModel(
        {
          agentId: agent.id,
          requiredCapabilityIds: ["ai.vision"],
          requiredModelCapabilityIds: ["ai.chat", "ai.vision"],
        },
        registries(),
      ),
    ).toThrowError(expect.objectContaining({ kind: "AGENT_MISSING_CAPABILITY" }));
  });
});
