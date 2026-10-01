import type { Agent } from "@polyon/contracts";
import { describe, expect, it } from "vitest";

import { buildAgentRolePrompt } from "./role-prompts";

const baseAgent: Agent = {
  id: "researcher-1",
  name: "Researcher",
  role: "Researcher",
  roleId: "researcher",
  description: "Researches independently.",
  status: "ACTIVE",
  capabilityIds: ["ai.chat", "ai.reasoning"],
  preferredModelId: "model-1",
  fallbackModelIds: [],
  createdAt: "2026-09-29T00:00:00.000Z",
  updatedAt: "2026-09-29T00:00:00.000Z",
};

describe("buildAgentRolePrompt", () => {
  it("uses the built-in role identity and stage", () => {
    const prompt = buildAgentRolePrompt(baseAgent, "research");

    expect(prompt).toContain("POLYON role: Researcher.");
    expect(prompt).toContain("Execution stage: research.");
    expect(prompt).toContain("source provenance");
  });

  it("supports an explicit role override for infrastructure without an Agent object", () => {
    const prompt = buildAgentRolePrompt(undefined, "planning", "planner");

    expect(prompt).toContain("POLYON role: Generalist.");
    expect(prompt).toContain("Execution stage: planning.");
    expect(prompt).toContain("bounded steps");
  });

  it("falls back safely for custom roles", () => {
    const prompt = buildAgentRolePrompt(
      {
        ...baseAgent,
        role: "Custom Operations",
        roleId: undefined,
      },
      "conversation",
    );

    expect(prompt).toContain("POLYON role: Custom Operations.");
    expect(prompt).toContain("never bypass POLYON policy");
  });
});
