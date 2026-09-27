import type { ToolAdapter } from "./tool-adapter";
import { describe, expect, it } from "vitest";

import {
  InMemoryToolAdapterRegistry,
  ToolAdapterRegistryError,
} from "./tool-adapter-registry";

const adapter: ToolAdapter = {
  toolId: "tool-1",
  async invoke({ input }) {
    return { output: String(input) };
  },
};

describe("InMemoryToolAdapterRegistry", () => {
  it("registers and retrieves a tool adapter", () => {
    const registry = new InMemoryToolAdapterRegistry();

    registry.register(adapter);

    expect(registry.get("tool-1")).toBe(adapter);
  });

  it("returns undefined for an unknown tool", () => {
    const registry = new InMemoryToolAdapterRegistry();

    expect(registry.get("missing")).toBeUndefined();
  });

  it("rejects duplicate tool adapters", () => {
    const registry = new InMemoryToolAdapterRegistry();
    registry.register(adapter);

    expect(() => registry.register(adapter)).toThrowError(
      new ToolAdapterRegistryError("TOOL_ADAPTER_ALREADY_EXISTS", "tool-1"),
    );
  });

  it("lists adapters by registration order", () => {
    const registry = new InMemoryToolAdapterRegistry();
    const second: ToolAdapter = {
      ...adapter,
      toolId: "tool-2",
    };

    registry.register(adapter);
    registry.register(second);

    expect(registry.list().map((entry) => entry.toolId)).toEqual([
      "tool-1",
      "tool-2",
    ]);
  });
});
