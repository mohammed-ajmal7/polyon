import type { Tool, ToolId } from "@polyon/contracts";

import type { ToolAdapterRegistry } from "./tool-adapter-registry";
import { InMemoryToolAdapterRegistry } from "./tool-adapter-registry";
import { ScopedFilesystemReadToolAdapter } from "./scoped-filesystem-read-adapter";
import { ScopedTerminalToolAdapter } from "./scoped-terminal-tool-adapter";
import { ScopedGitReadToolAdapter } from "./scoped-git-read-tool-adapter";
import { ScopedGitWriteToolAdapter } from "./scoped-git-write-tool-adapter";
import { ScopedGitCommitToolAdapter } from "./scoped-git-commit-tool-adapter";
import { ScopedGitPublishToolAdapter } from "./scoped-git-publish-tool-adapter";
import { ScopedArtifactWriteToolAdapter } from "./scoped-artifact-write-tool-adapter";
import type { ToolRegistry } from "./tool-registry";
import { InMemoryToolRegistry } from "./tool-registry";

export const BUILTIN_TOOL_IDS = {
  filesystemRead: "filesystem.read.scoped" as ToolId,
  terminalExecute: "terminal.execute.scoped" as ToolId,
  gitRead: "git.read.scoped" as ToolId,
  gitWrite: "git.write.scoped" as ToolId,
  gitCommit: "git.commit.scoped" as ToolId,
  gitPublish: "git.publish.scoped" as ToolId,
  artifactWrite: "artifact.write.scoped" as ToolId,
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
  readonly gitWriteRoot?: string;
  readonly gitWriteExecutable?: string;
  readonly gitWriteDefaultTimeoutMs?: number;
  readonly gitWriteMaxTimeoutMs?: number;
  readonly gitWriteMaxOutputBytes?: number;
  readonly gitWriteEnvironmentKeys?: readonly string[];
  readonly gitWriteEnabled?: boolean;
  readonly gitCommitRoot?: string;
  readonly gitCommitExecutable?: string;
  readonly gitCommitDefaultTimeoutMs?: number;
  readonly gitCommitMaxTimeoutMs?: number;
  readonly gitCommitMaxOutputBytes?: number;
  readonly gitCommitEnvironmentKeys?: readonly string[];
  readonly gitCommitEnabled?: boolean;
  readonly gitPublishRoot?: string;
  readonly gitPublishAllowedRemotes?: readonly string[];
  readonly gitPublishExecutable?: string;
  readonly gitPublishDefaultTimeoutMs?: number;
  readonly gitPublishMaxTimeoutMs?: number;
  readonly gitPublishMaxOutputBytes?: number;
  readonly gitPublishEnvironmentKeys?: readonly string[];
  readonly gitPublishEnabled?: boolean;
  readonly artifactRoot?: string;
  readonly artifactDefaultKind?:
    "DOCUMENT" | "IMAGE" | "VIDEO" | "AUDIO" | "CODE" | "DATASET" | "REPORT" | "OTHER";
  readonly artifactWriteEnabled?: boolean;
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

    registrations.push({
      tool: filesystemReadTool,
      adapter: filesystemReadAdapter,
    });
  }

  if (options.terminalRoot !== undefined && options.terminalAllowedCommands !== undefined) {
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
      description: "Inspects repository state without modifying Git history or the working tree.",
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

  if (options.gitWriteRoot !== undefined) {
    const gitWriteTool: Tool = {
      id: BUILTIN_TOOL_IDS.gitWrite,
      name: "Scoped Git write",
      description:
        "Performs narrowly defined Git working-tree/index writes through explicit operations.",
      kind: "GIT",
      actionKinds: ["WRITE"],
      inputSchema: {
        type: "object",
        required: ["operation"],
        additionalProperties: false,
        properties: {
          operation: {
            type: "string",
            enum: ["CREATE_BRANCH", "STAGE_PATHS", "UNSTAGE_PATHS"],
          },
          branchName: {
            type: "string",
            minLength: 1,
            maxLength: 200,
          },
          paths: {
            type: "array",
            minItems: 1,
            items: {
              type: "string",
              minLength: 1,
            },
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
      enabled: options.gitWriteEnabled ?? true,
    };

    const gitWriteAdapter = new ScopedGitWriteToolAdapter({
      toolId: gitWriteTool.id,
      rootDir: options.gitWriteRoot,
      gitExecutable: options.gitWriteExecutable,
      defaultTimeoutMs: options.gitWriteDefaultTimeoutMs,
      maxTimeoutMs: options.gitWriteMaxTimeoutMs,
      defaultMaxOutputBytes: options.gitWriteMaxOutputBytes,
      environmentKeys: options.gitWriteEnvironmentKeys,
    });

    registries.tools.register(gitWriteTool);
    registries.adapters.register(gitWriteAdapter);
  }

  if (options.artifactRoot !== undefined) {
    const artifactTool: Tool = {
      id: BUILTIN_TOOL_IDS.artifactWrite,
      name: "Scoped artifact write",
      description:
        "Creates or idempotently replays a text artifact inside the configured artifact root.",
      kind: "ARTIFACT",
      actionKinds: ["WRITE"],
      inputSchema: {
        type: "object",
        required: ["name", "content"],
        additionalProperties: false,
        properties: {
          name: {
            type: "string",
            minLength: 1,
          },
          content: {
            type: "string",
          },
          kind: {
            type: "string",
            enum: ["DOCUMENT", "IMAGE", "VIDEO", "AUDIO", "CODE", "DATASET", "REPORT", "OTHER"],
          },
          mimeType: {
            type: "string",
            minLength: 1,
          },
        },
      },
      enabled: options.artifactWriteEnabled ?? true,
    };

    const artifactAdapter = new ScopedArtifactWriteToolAdapter({
      toolId: artifactTool.id,
      rootDir: options.artifactRoot,
      defaultKind: options.artifactDefaultKind,
    });

    registries.tools.register(artifactTool);
    registries.adapters.register(artifactAdapter);
  }

  if (options.gitCommitRoot !== undefined) {
    const gitCommitTool: Tool = {
      id: BUILTIN_TOOL_IDS.gitCommit,
      name: "Scoped Git commit",
      description: "Creates a commit from the existing Git index with an explicit commit message.",
      kind: "GIT",
      actionKinds: ["WRITE"],
      inputSchema: {
        type: "object",
        required: ["message"],
        additionalProperties: false,
        properties: {
          message: {
            type: "string",
            minLength: 1,
            maxLength: 500,
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
      enabled: options.gitCommitEnabled ?? true,
    };

    const gitCommitAdapter = new ScopedGitCommitToolAdapter({
      toolId: gitCommitTool.id,
      rootDir: options.gitCommitRoot,
      gitExecutable: options.gitCommitExecutable,
      defaultTimeoutMs: options.gitCommitDefaultTimeoutMs,
      maxTimeoutMs: options.gitCommitMaxTimeoutMs,
      defaultMaxOutputBytes: options.gitCommitMaxOutputBytes,
      environmentKeys: options.gitCommitEnvironmentKeys,
    });

    registries.tools.register(gitCommitTool);
    registries.adapters.register(gitCommitAdapter);
  }

  if (options.gitPublishRoot !== undefined && options.gitPublishAllowedRemotes !== undefined) {
    const gitPublishTool: Tool = {
      id: BUILTIN_TOOL_IDS.gitPublish,
      name: "Scoped Git publish",
      description: "Publishes the current HEAD to an explicitly allowlisted Git remote and branch.",
      kind: "GIT",
      actionKinds: ["PUBLISH"],
      inputSchema: {
        type: "object",
        required: ["remote", "branch"],
        additionalProperties: false,
        properties: {
          remote: {
            type: "string",
            minLength: 1,
          },
          branch: {
            type: "string",
            minLength: 1,
            maxLength: 200,
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
      enabled: options.gitPublishEnabled ?? true,
    };

    const gitPublishAdapter = new ScopedGitPublishToolAdapter({
      toolId: gitPublishTool.id,
      rootDir: options.gitPublishRoot,
      allowedRemotes: options.gitPublishAllowedRemotes,
      gitExecutable: options.gitPublishExecutable,
      defaultTimeoutMs: options.gitPublishDefaultTimeoutMs,
      maxTimeoutMs: options.gitPublishMaxTimeoutMs,
      defaultMaxOutputBytes: options.gitPublishMaxOutputBytes,
      environmentKeys: options.gitPublishEnvironmentKeys,
    });

    registries.tools.register(gitPublishTool);
    registries.adapters.register(gitPublishAdapter);
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
