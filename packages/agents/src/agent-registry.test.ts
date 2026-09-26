import type { Agent } from "@polyon/contracts";
import { describe, expect, it } from "vitest";

import { AgentRegistryError, InMemoryAgentRegistry } from "./agent-registry";

const agent: Agent = {
  id: "agent-1",
  name: "Research Agent",
  role: "Researcher",
  description: "Collects and synthesizes evidence.",
  status: "ACTIVE",
  capabilityIds: ["research"],
  preferredModelId: "model-1",
  fallbackModelIds: ["model-2"],
  createdAt: "2026-09-27T01:00:00.000Z",
  updatedAt: "2026-09-27T01:00:00.000Z",
};

describe("InMemoryAgentRegistry", () => {
  it("registers and retrieves an agent", () => {
    const registry = new InMemoryAgentRegistry();

    registry.register(agent);

    expect(registry.get("agent-1")).toEqual(agent);
  });

  it("returns undefined for an unknown agent", () => {
    const registry = new InMemoryAgentRegistry();

    expect(registry.get("missing")).toBeUndefined();
  });

  it("lists registered agents", () => {
    const registry = new InMemoryAgentRegistry();
    registry.register(agent);
    registry.register({
      ...agent,
      id: "agent-2",
      name: "Coding Agent",
      role: "Coder",
    });

    expect(registry.list().map((entry) => entry.id)).toEqual(["agent-1", "agent-2"]);
  });

  it("rejects duplicate agent identifiers", () => {
    const registry = new InMemoryAgentRegistry();
    registry.register(agent);

    expect(() => registry.register(agent)).toThrowError(
      new AgentRegistryError("AGENT_ALREADY_EXISTS", "agent-1"),
    );
  });

  it("does not expose mutable registry state", () => {
    const registry = new InMemoryAgentRegistry();
    registry.register(agent);

    const retrieved = registry.get("agent-1")!;
    (retrieved.capabilityIds as string[]).push("coding");

    const listed = registry.list()[0]!;
    expect(listed.capabilityIds).toEqual(["research"]);
  });
});
