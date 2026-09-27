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
      description: "Reads a bounded file from the configured POLYON filesystem root.",
      kind: "FILESYSTEM",
      actionKinds: ["READ"],
      inputSchema: {
        type: "object",
        required: ["path"],
        additionalProperties: false,
        properties: {
          path: {
            type: "string",
            minLength: 1,
          },
          maxBytes: {
            type: "integer",
            minimum: 1,
          },
        },
      },
      enabled: true,
    });
    expect(registration.adapter.toolId).toBe(BUILTIN_TOOL_IDS.filesystemRead);
    expect(registries.tools.get(BUILTIN_TOOL_IDS.filesystemRead)).toEqual(registration.tool);
    expect(registries.adapters.get(BUILTIN_TOOL_IDS.filesystemRead)).toBe(registration.adapter);
  });

  it("can register terminal execution without requiring filesystem registration", () => {
    const registries = createInMemoryBuiltinToolRegistries();

    registerBuiltinTools(registries, {
      terminalRoot: process.cwd(),
      terminalAllowedCommands: [process.execPath],
    });

    expect(registries.tools.get(BUILTIN_TOOL_IDS.filesystemRead)).toBeUndefined();
    expect(registries.tools.get(BUILTIN_TOOL_IDS.terminalExecute)).toMatchObject({
      kind: "TERMINAL",
      actionKinds: ["TERMINAL"],
      enabled: true,
    });
    expect(registries.adapters.get(BUILTIN_TOOL_IDS.terminalExecute)).toBeDefined();
  });

  it("registers artifact catalog and content read independently", () => {
    const registries = createInMemoryBuiltinToolRegistries();

    registerBuiltinTools(registries, {
      artifactList: () => [],
      artifactRead: () => ({
        artifact: {
          id: "artifact-1",
          kind: "REPORT",
          name: "report.txt",
          location: "/artifacts/report.txt",
          status: "AVAILABLE",
          createdAt: "2026-09-27T01:00:00.000Z",
          updatedAt: "2026-09-27T01:00:00.000Z",
        },
        content: "POLYON",
        sizeBytes: 6,
        sha256: "a".repeat(64),
      }),
    });

    expect(registries.tools.get(BUILTIN_TOOL_IDS.artifactList)).toMatchObject({
      kind: "ARTIFACT",
      actionKinds: ["READ"],
      enabled: true,
    });
    expect(registries.tools.get(BUILTIN_TOOL_IDS.artifactRead)).toMatchObject({
      kind: "ARTIFACT",
      actionKinds: ["READ"],
      enabled: true,
    });
    expect(registries.adapters.get(BUILTIN_TOOL_IDS.artifactList)).toBeDefined();
    expect(registries.adapters.get(BUILTIN_TOOL_IDS.artifactRead)).toBeDefined();
  });

  it("registers scoped Git publish independently", () => {
    const registries = createInMemoryBuiltinToolRegistries();

    registerBuiltinTools(registries, {
      gitPublishRoot: process.cwd(),
      gitPublishAllowedRemotes: ["origin"],
    });

    expect(registries.tools.get(BUILTIN_TOOL_IDS.gitPublish)).toMatchObject({
      kind: "GIT",
      actionKinds: ["PUBLISH"],
      enabled: true,
    });
    expect(registries.adapters.get(BUILTIN_TOOL_IDS.gitPublish)).toBeDefined();
  });

  it("registers scoped Git read independently", () => {
    const registries = createInMemoryBuiltinToolRegistries();

    registerBuiltinTools(registries, {
      gitRoot: process.cwd(),
    });

    expect(registries.tools.get(BUILTIN_TOOL_IDS.gitRead)).toMatchObject({
      kind: "GIT",
      actionKinds: ["READ"],
      enabled: true,
    });
    expect(registries.adapters.get(BUILTIN_TOOL_IDS.gitRead)).toBeDefined();
  });

  it("can disable the built-in tool without removing its adapter boundary", () => {
    const registries = createInMemoryBuiltinToolRegistries();

    const [registration] = registerBuiltinTools(registries, {
      filesystemRoot: process.cwd(),
      filesystemReadEnabled: false,
    });

    expect(registration.tool.enabled).toBe(false);
    expect(registries.adapters.get(BUILTIN_TOOL_IDS.filesystemRead)).toBe(registration.adapter);
  });
});
