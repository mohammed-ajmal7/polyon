import type { ToolAdapter, ToolInvocationRequest } from "./tool-adapter";
import {
  ScopedTerminalToolAdapter,
  type ScopedTerminalToolOutput,
} from "./scoped-terminal-tool-adapter";

export interface ScopedGitPublishToolInput {
  readonly remote: string;
  readonly branch: string;
  readonly timeoutMs?: number;
  readonly maxOutputBytes?: number;
}

export interface ScopedGitPublishToolOutput {
  readonly remote: string;
  readonly branch: string;
  readonly commandOutput: ScopedTerminalToolOutput;
}

export type ScopedGitPublishToolErrorKind =
  | "INVALID_INPUT"
  | "REMOTE_NOT_ALLOWED"
  | "INVALID_BRANCH"
  | "COMMAND_FAILED";

export class ScopedGitPublishToolError extends Error {
  readonly kind: ScopedGitPublishToolErrorKind;

  constructor(
    kind: ScopedGitPublishToolErrorKind,
    message: string,
  ) {
    super(message);
    this.name = "ScopedGitPublishToolError";
    this.kind = kind;
  }
}

export interface ScopedGitPublishToolAdapterOptions {
  readonly toolId: string;
  readonly rootDir: string;
  readonly allowedRemotes: readonly string[];
  readonly gitExecutable?: string;
  readonly defaultTimeoutMs?: number;
  readonly maxTimeoutMs?: number;
  readonly defaultMaxOutputBytes?: number;
  readonly environmentKeys?: readonly string[];
}

function isSafeBranch(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= 200 &&
    !value.includes("..") &&
    !value.includes("@{") &&
    !value.includes("\\") &&
    !/[\s~^:?*\[]/.test(value) &&
    !value.startsWith("/") &&
    !value.endsWith("/") &&
    !value.endsWith(".") &&
    !value.endsWith(".lock")
  );
}

export class ScopedGitPublishToolAdapter
  implements ToolAdapter<ScopedGitPublishToolInput, ScopedGitPublishToolOutput>
{
  readonly toolId: string;

  private readonly allowedRemotes: ReadonlySet<string>;
  private readonly gitExecutablePath: string;
  private readonly terminal: ScopedTerminalToolAdapter;

  constructor(options: ScopedGitPublishToolAdapterOptions) {
    if (options.toolId.trim() === "") {
      throw new RangeError("toolId must not be empty.");
    }

    if (options.allowedRemotes.length === 0) {
      throw new RangeError("allowedRemotes must contain at least one remote.");
    }

    for (const remote of options.allowedRemotes) {
      if (remote.trim() === "") {
        throw new RangeError("allowedRemotes must not contain empty values.");
      }
    }

    this.toolId = options.toolId;
    this.allowedRemotes = new Set(options.allowedRemotes);
    this.gitExecutablePath = options.gitExecutable ?? "git";
    this.terminal = new ScopedTerminalToolAdapter({
      toolId: options.toolId,
      rootDir: options.rootDir,
      allowedCommands: [this.gitExecutablePath],
      defaultTimeoutMs: options.defaultTimeoutMs,
      maxTimeoutMs: options.maxTimeoutMs,
      defaultMaxOutputBytes: options.defaultMaxOutputBytes,
      environmentKeys: options.environmentKeys,
    });
  }

  async invoke(
    request: ToolInvocationRequest<ScopedGitPublishToolInput>,
  ): Promise<{ output: ScopedGitPublishToolOutput }> {
    const input = request.input;

    if (
      input === null ||
      typeof input !== "object" ||
      typeof input.remote !== "string" ||
      input.remote.trim() === "" ||
      typeof input.branch !== "string"
    ) {
      throw new ScopedGitPublishToolError(
        "INVALID_INPUT",
        "Git publish requires a remote and branch.",
      );
    }

    if (!this.allowedRemotes.has(input.remote)) {
      throw new ScopedGitPublishToolError(
        "REMOTE_NOT_ALLOWED",
        `Git remote is not allowlisted: ${input.remote}.`,
      );
    }

    if (!isSafeBranch(input.branch)) {
      throw new ScopedGitPublishToolError(
        "INVALID_BRANCH",
        "Git publish branch uses an unsafe Git ref format.",
      );
    }

    try {
      const result = await this.terminal.invoke({
        input: {
          command: this.gitExecutablePath,
          args: ["push", input.remote, `HEAD:refs/heads/${input.branch}`],
          timeoutMs: input.timeoutMs,
          maxOutputBytes: input.maxOutputBytes,
        },
      });

      return {
        output: {
          remote: input.remote,
          branch: input.branch,
          commandOutput: result.output,
        },
      };
    } catch (error) {
      throw new ScopedGitPublishToolError(
        "COMMAND_FAILED",
        error instanceof Error ? error.message : String(error),
      );
    }
  }
}
