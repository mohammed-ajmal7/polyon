import type { Tool, ToolId } from "@polyon/contracts";

import type { ToolAdapterRegistry } from "./tool-adapter-registry";
import { InMemoryToolAdapterRegistry } from "./tool-adapter-registry";
import { ScopedFilesystemReadToolAdapter } from "./scoped-filesystem-read-adapter";
import { ScopedTerminalToolAdapter } from "./scoped-terminal-tool-adapter";
import { ScopedGitReadToolAdapter } from "./scoped-git-read-tool-adapter";
import type { ToolRegistry } from "./tool-registry";
import { InMemoryToolRegistry } from "./tool-registry";

export const BUILTIN_TOOL_IDS = {
  filesystemRead: "filesystem.read.scoped" as ToolId,
  terminalExecute: "terminal.execute.scoped" as ToolId,
  gitRead: "git.read.scoped" as ToolId,
} as const;

export interface BuiltinToolRegistries {
  readonly tools: ToolRegistry;
  readonly adapters: ToolAdapterRegistry;
}

export interface BuiltinToolOptions {
  readonly filesystemRoot?: string;
  readonly filesystemReadMaxBytes?: number;
  readonly filesystemReadEnabled?: boolean;
  readonly terminalRoot?: string;
  readonly terminalAllowedCommands?: readonly string[];
  readonly terminalDefaultTimeoutMs?: number;
  readonly terminalMaxTimeoutMs?: number;
  readonly terminalMaxOutputBytes?: number;
  readonly terminalEnvironmentKeys?: readonly string[];
  readonly terminalEnabled?: boolean;
  readonly gitRoot?: string;
  readonly gitExecutable?: string;
  readonly gitDefaultTimeoutMs?: number;
  readonly gitMaxTimeoutMs?: number;
  readonly gitMaxOutputBytes?: number;
  readonly gitEnvironmentKeys?: readonly string[];
  readonly gitEnabled?: boolean;
}

export interface BuiltinFilesystemReadToolRegistration {
  readonly tool: Tool;
  readonly adapter: ScopedFilesystemReadToolAdapter;
}

export function registerBuiltinTools(
  registries: BuiltinToolRegistries,
  options: BuiltinToolOptions,
): readonly BuiltinFilesystemReadToolRegistration[] {
  const registrations: BuiltinFilesystemReadToolRegistration[] = [];

  if (options.filesystemRoot !== undefined) {
    const filesystemReadTool: Tool = {
      id: BUILTIN_TOOL_IDS.filesystemRead,
      name: "Scoped filesystem read",
      description:
        "Reads a bounded file from the configured POLYON filesystem root.",
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

    registrations.push({
      tool: filesystemReadTool,
      adapter: filesystemReadAdapter,
    });
  }

  if (
    options.terminalRoot !== undefined &&
    options.terminalAllowedCommands !== undefined
  ) {
    const terminalTool: Tool = {
      id: BUILTIN_TOOL_IDS.terminalExecute,
      name: "Scoped terminal execution",
      description:
        "Runs an allowlisted command without a shell inside the configured POLYON terminal root.",
      kind: "TERMINAL",
      actionKinds: ["TERMINAL"],
      inputSchema: {
        type: "object",
        required: ["command"],
        additionalProperties: false,
        properties: {
          command: {
            type: "string",
            minLength: 1,
          },
          args: {
            type: "array",
            items: {
              type: "string",
            },
          },
          cwd: {
            type: "string",
            minLength: 1,
          },
          timeoutMs: {
            type: "integer",
            minimum: 1,
          },
          maxOutputBytes: {
            type: "integer",
            minimum: 1,
          },
        },
      },
      enabled: options.terminalEnabled ?? true,
    };

    const terminalAdapter = new ScopedTerminalToolAdapter({
      toolId: terminalTool.id,
      rootDir: options.terminalRoot,
      allowedCommands: options.terminalAllowedCommands,
      defaultTimeoutMs: options.terminalDefaultTimeoutMs,
      maxTimeoutMs: options.terminalMaxTimeoutMs,
      defaultMaxOutputBytes: options.terminalMaxOutputBytes,
      environmentKeys: options.terminalEnvironmentKeys,
    });

    registries.tools.register(terminalTool);
    registries.adapters.register(terminalAdapter);
  }

  if (options.gitRoot !== undefined) {
    const gitTool: Tool = {
      id: BUILTIN_TOOL_IDS.gitRead,
      name: "Scoped Git read",
      description:
        "Inspects repository state without modifying Git history or the working tree.",
      kind: "GIT",
      actionKinds: ["READ"],
      inputSchema: {
        type: "object",
        required: ["operation"],
        additionalProperties: false,
        properties: {
          operation: {
            type: "string",
            enum: ["STATUS", "DIFF", "LOG", "SHOW"],
          },
          maxOutputBytes: {
            type: "integer",
            minimum: 1,
          },
          timeoutMs: {
            type: "integer",
            minimum: 1,
          },
        },
      },
      enabled: options.gitEnabled ?? true,
    };

    const gitAdapter = new ScopedGitReadToolAdapter({
      toolId: gitTool.id,
      rootDir: options.gitRoot,
      gitExecutable: options.gitExecutable,
      defaultTimeoutMs: options.gitDefaultTimeoutMs,
      maxTimeoutMs: options.gitMaxTimeoutMs,
      defaultMaxOutputBytes: options.gitMaxOutputBytes,
      environmentKeys: options.gitEnvironmentKeys,
    });

    registries.tools.register(gitTool);
    registries.adapters.register(gitAdapter);
  }

  return registrations;
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
