import type { Tool, ToolId } from "@polyon/contracts";

import type { ToolAdapterRegistry } from "./tool-adapter-registry";
import { InMemoryToolAdapterRegistry } from "./tool-adapter-registry";
import { ScopedFilesystemReadToolAdapter } from "./scoped-filesystem-read-adapter";
import type { ToolRegistry } from "./tool-registry";
import { InMemoryToolRegistry } from "./tool-registry";

export const BUILTIN_TOOL_IDS = {
  filesystemRead: "filesystem.read.scoped" as ToolId,
} as const;

export interface BuiltinToolRegistries {
  readonly tools: ToolRegistry;
  readonly adapters: ToolAdapterRegistry;
}

export interface BuiltinToolOptions {
  readonly filesystemRoot: string;
  readonly filesystemReadMaxBytes?: number;
  readonly filesystemReadEnabled?: boolean;
}

export interface BuiltinFilesystemReadToolRegistration {
  readonly tool: Tool;
  readonly adapter: ScopedFilesystemReadToolAdapter;
}

export function registerBuiltinTools(
  registries: BuiltinToolRegistries,
  options: BuiltinToolOptions,
): readonly BuiltinFilesystemReadToolRegistration[] {
  const filesystemReadTool: Tool = {
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
    enabled: options.filesystemReadEnabled ?? true,
  };

  const filesystemReadAdapter = new ScopedFilesystemReadToolAdapter({
    toolId: filesystemReadTool.id,
    rootDir: options.filesystemRoot,
    defaultMaxBytes: options.filesystemReadMaxBytes,
  });

  registries.tools.register(filesystemReadTool);
  registries.adapters.register(filesystemReadAdapter);

  return [
    {
      tool: filesystemReadTool,
      adapter: filesystemReadAdapter,
    },
  ];
}

export function createInMemoryBuiltinToolRegistries(): {
  readonly tools: InMemoryToolRegistry;
  readonly adapters: InMemoryToolAdapterRegistry;
} {
  return {
    tools: new InMemoryToolRegistry(),
    adapters: new InMemoryToolAdapterRegistry(),
  };
}
