import { describe, expect, it } from "vitest";

import {
  AI_CAPABILITY_DEFINITIONS,
  BUILT_IN_AGENT_ROLES,
  getBuiltInAgentRole,
  isAiCapabilityId,
} from "./index";

describe("AI capability catalog", () => {
  it("defines the complete core model capability set", () => {
    expect(AI_CAPABILITY_DEFINITIONS.map((item) => item.id)).toEqual([
      "ai.chat",
      "ai.reasoning",
      "ai.tool-calling",
      "ai.vision",
      "ai.audio",
      "ai.embeddings",
      "ai.structured-output",
      "ai.long-context",
    ]);
  });

  it("recognizes only canonical AI capability ids", () => {
    expect(isAiCapabilityId("ai.vision")).toBe(true);
    expect(isAiCapabilityId("research")).toBe(false);
  });
});

describe("built-in agent roles", () => {
  it("defines every required POLYON core role", () => {
    expect(BUILT_IN_AGENT_ROLES.map((role) => role.id)).toEqual([
      "planner",
      "researcher",
      "analyst",
      "specialist",
      "critic",
      "fact-checker",
      "judge",
      "synthesizer",
      "action-agent",
    ]);
  });

  it("resolves role metadata deterministically", () => {
    expect(getBuiltInAgentRole("synthesizer")).toEqual(
      expect.objectContaining({
        name: "Synthesizer",
        defaultCapabilityIds: expect.arrayContaining(["ai.long-context"]),
      }),
    );
    expect(getBuiltInAgentRole("planner")).toEqual(
      expect.objectContaining({
        defaultCapabilityIds: expect.arrayContaining(["ai.structured-output"]),
      }),
    );
  });
});
