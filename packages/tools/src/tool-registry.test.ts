import type { Tool } from "@polyon/contracts";
import { describe, expect, it } from "vitest";

import { InMemoryToolRegistry, ToolRegistryError } from "./tool-registry";

const tool: Tool = {
  id: "tool-1",
  name: "Terminal",
  description: "Runs controlled terminal commands.",
  kind: "TERMINAL",
  actionKinds: ["TERMINAL"],
  enabled: true,
};

describe("InMemoryToolRegistry", () => {
  it("registers and retrieves a tool", () => {
    const registry = new InMemoryToolRegistry();

    registry.register(tool);

    expect(registry.get("tool-1")).toEqual(tool);
  });

  it("returns undefined for an unknown tool", () => {
    const registry = new InMemoryToolRegistry();

    expect(registry.get("missing")).toBeUndefined();
  });

  it("rejects duplicate tool identifiers", () => {
    const registry = new InMemoryToolRegistry();
    registry.register(tool);

    expect(() => registry.register(tool)).toThrowError(
      new ToolRegistryError("TOOL_ALREADY_EXISTS", "tool-1"),
    );
  });

  it("lists registered tools", () => {
    const registry = new InMemoryToolRegistry();
    registry.register(tool);
    registry.register({
      ...tool,
      id: "tool-2",
      name: "Git",
      kind: "GIT",
      actionKinds: ["GIT"],
    });

    expect(registry.list().map((entry) => entry.id)).toEqual(["tool-1", "tool-2"]);
  });

  it("does not expose mutable tool state", () => {
    const registry = new InMemoryToolRegistry();
    registry.register(tool);

    const retrieved = registry.get("tool-1")!;
    (retrieved.actionKinds as string[]).push("WRITE");

    expect(registry.get("tool-1")?.actionKinds).toEqual(["TERMINAL"]);
  });
});
