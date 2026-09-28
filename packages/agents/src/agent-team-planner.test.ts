import type { Agent, Model, Provider } from "@polyon/contracts";
import { describe, expect, it } from "vitest";

import { InMemoryAgentRegistry } from "./agent-registry";
import { AgentTeamPlannerError, planAgentTeam } from "./agent-team-planner";
import { InMemoryModelRegistry } from "./model-registry";
import { InMemoryProviderRegistry } from "./provider-registry";

const agents: Agent[] = [
  {
    id: "researcher",
    name: "Researcher",
    role: "Research specialist",
    description: "Researches independently.",
    status: "ACTIVE",
    capabilityIds: ["research"],
    preferredModelId: "research-model",
    fallbackModelIds: [],
    allowedToolIds: ["knowledge.search"],
    maxRounds: 3,
    maxTokens: 4000,
    createdAt: "2026-09-29T00:00:00.000Z",
    updatedAt: "2026-09-29T00:00:00.000Z",
  },
  {
    id: "analyst",
    name: "Analyst",
    role: "Analytical specialist",
    description: "Analyzes competing explanations.",
    status: "ACTIVE",
    capabilityIds: ["research"],
    preferredModelId: "analyst-model",
    fallbackModelIds: [],
    allowedToolIds: ["knowledge.search"],
    maxRounds: 3,
    maxTokens: 4000,
    createdAt: "2026-09-29T00:00:00.000Z",
    updatedAt: "2026-09-29T00:00:00.000Z",
  },
  {
    id: "disabled",
    name: "Disabled",
    role: "Research specialist",
    description: "Unavailable.",
    status: "DISABLED",
    capabilityIds: ["research"],
    preferredModelId: "disabled-model",
    fallbackModelIds: [],
    createdAt: "2026-09-29T00:00:00.000Z",
    updatedAt: "2026-09-29T00:00:00.000Z",
  },
  {
    id: "cloud",
    name: "Cloud specialist",
    role: "Specialist",
    description: "Cloud-only specialist.",
    status: "ACTIVE",
    capabilityIds: ["research"],
    preferredModelId: "cloud-model",
    fallbackModelIds: [],
    createdAt: "2026-09-29T00:00:00.000Z",
    updatedAt: "2026-09-29T00:00:00.000Z",
  },
];

const models: Model[] = [
  {
    id: "research-model",
    providerId: "local-a",
    name: "Research local",
    kind: "TEXT",
    capabilityIds: ["research"],
    enabled: true,
  },
  {
    id: "analyst-model",
    providerId: "local-b",
    name: "Analyst local",
    kind: "TEXT",
    capabilityIds: ["research"],
    enabled: true,
  },
  {
    id: "disabled-model",
    providerId: "local-a",
    name: "Disabled",
    kind: "TEXT",
    capabilityIds: ["research"],
    enabled: true,
  },
  {
    id: "cloud-model",
    providerId: "cloud",
    name: "Cloud",
    kind: "TEXT",
    capabilityIds: ["research"],
    enabled: true,
  },
];

const providers: Provider[] = [
  {
    id: "local-a",
    name: "Local A",
    kind: "LOCAL_MODEL",
    enabled: true,
  },
  {
    id: "local-b",
    name: "Local B",
    kind: "LOCAL_MODEL",
    enabled: true,
  },
  {
    id: "cloud",
    name: "Cloud",
    kind: "HOSTED_MODEL",
    enabled: true,
  },
];

function createRegistries() {
  const agentRegistry = new InMemoryAgentRegistry();
  const modelRegistry = new InMemoryModelRegistry();
  const providerRegistry = new InMemoryProviderRegistry();

  for (const agent of agents) agentRegistry.register(agent);
  for (const model of models) modelRegistry.register(model);
  for (const provider of providers) providerRegistry.register(provider);

  return {
    agents: agentRegistry,
    models: modelRegistry,
    providers: providerRegistry,
  };
}

describe("planAgentTeam", () => {
  it("forms a bounded team using preferred roles", () => {
    const result = planAgentTeam(
      {
        requiredCapabilityIds: ["research"],
        preferredRoles: ["Research specialist", "Analytical specialist"],
        maximumAgents: 2,
      },
      createRegistries(),
    );

    expect(result.members.map((member) => member.agent.id)).toEqual([
      "analyst",
      "researcher",
    ]);
  });

  it("supports an explicit agent allowlist and exclusions", () => {
    const result = planAgentTeam(
      {
        requiredCapabilityIds: ["research"],
        minimumAgents: 1,
        maximumAgents: 2,
        allowedAgentIds: ["researcher", "analyst"],
        excludedAgentIds: ["analyst"],
      },
      createRegistries(),
    );

    expect(result.members.map((member) => member.agent.id)).toEqual(["researcher"]);
  });

  it("enforces privacy through the shared routing boundary", () => {
    const result = planAgentTeam(
      {
        requiredCapabilityIds: ["research"],
        privacyClass: "local",
        minimumAgents: 1,
        maximumAgents: 2,
      },
      createRegistries(),
    );

    expect(result.members.every((member) => member.provider.kind === "LOCAL_MODEL")).toBe(true);
  });

  it("can prefer provider diversity when the roster offers it", () => {
    const result = planAgentTeam(
      {
        requiredCapabilityIds: ["research"],
        minimumAgents: 2,
        maximumAgents: 2,
        preferProviderDiversity: true,
      },
      createRegistries(),
    );

    expect(new Set(result.members.map((member) => member.provider.id)).size).toBe(2);
  });

  it("rejects invalid team bounds", () => {
    expect(() =>
      planAgentTeam(
        {
          requiredCapabilityIds: [],
          minimumAgents: 2,
          maximumAgents: 9,
        },
        createRegistries(),
      ),
    ).toThrowError(expect.objectContaining({ kind: "INVALID_BOUNDS" }));
  });

  it("fails when the requested team cannot be formed", () => {
    expect(() =>
      planAgentTeam(
        {
          requiredCapabilityIds: ["research"],
          minimumAgents: 3,
          maximumAgents: 4,
          allowedAgentIds: ["researcher", "analyst"],
        },
        createRegistries(),
      ),
    ).toThrowError(
      new AgentTeamPlannerError(
        "INSUFFICIENT_AGENTS",
        "Unable to form the requested team: found 2, required at least 3.",
      ),
    );
  });
});
