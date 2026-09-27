import { describe, expect, it } from "vitest";

import {
  BUILTIN_TOOL_IDS,
  createInMemoryBuiltinToolRegistries,
  registerBuiltinTools,
} from "./builtin-tools";

describe("registerBuiltinTools", () => {
  it("registers the scoped filesystem read descriptor and adapter together", () => {
    const registries = createInMemoryBuiltinToolRegistries();

    const [registration] = registerBuiltinTools(registries, {
      filesystemRoot: process.cwd(),
    });

    expect(registration.tool).toEqual({
      id: BUILTIN_TOOL_IDS.filesystemRead,
      name: "Scoped filesystem read",
      description:
        "Reads a bounded file from the configured POLYON filesystem root.",
      kind: "FILESYSTEM",
      actionKinds: ["READ"],
      enabled: true,
    });
    expect(registration.adapter.toolId).toBe(BUILTIN_TOOL_IDS.filesystemRead);
    expect(registries.tools.get(BUILTIN_TOOL_IDS.filesystemRead)).toEqual(
      registration.tool,
    );
    expect(registries.adapters.get(BUILTIN_TOOL_IDS.filesystemRead)).toBe(
      registration.adapter,
    );
  });

  it("can disable the built-in tool without removing its adapter boundary", () => {
    const registries = createInMemoryBuiltinToolRegistries();

    const [registration] = registerBuiltinTools(registries, {
      filesystemRoot: process.cwd(),
      filesystemReadEnabled: false,
    });

    expect(registration.tool.enabled).toBe(false);
    expect(registries.adapters.get(BUILTIN_TOOL_IDS.filesystemRead)).toBe(
      registration.adapter,
    );
  });
});
