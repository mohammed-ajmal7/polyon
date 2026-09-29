import type { ToolAdapter, ToolInvocationRequest } from "./tool-adapter";
import {
  ScopedTerminalToolAdapter,
  type ScopedTerminalToolOutput,
} from "./scoped-terminal-tool-adapter";

export interface ScopedGitCommitToolInput {
  readonly message: string;
  readonly timeoutMs?: number;
  readonly maxOutputBytes?: number;
}

export interface ScopedGitCommitToolOutput {
  readonly message: string;
  readonly commandOutput: ScopedTerminalToolOutput;
}

export type ScopedGitCommitToolErrorKind = "INVALID_INPUT" | "OUTSIDE_ROOT" | "COMMAND_FAILED";

export class ScopedGitCommitToolError extends Error {
  readonly kind: ScopedGitCommitToolErrorKind;

  constructor(kind: ScopedGitCommitToolErrorKind, message: string) {
    super(message);
    this.name = "ScopedGitCommitToolError";
    this.kind = kind;
  }
}

export interface ScopedGitCommitToolAdapterOptions {
  readonly toolId: string;
  readonly rootDir: string;
  readonly gitExecutable?: string;
  readonly defaultTimeoutMs?: number;
  readonly maxTimeoutMs?: number;
  readonly defaultMaxOutputBytes?: number;
  readonly environmentKeys?: readonly string[];
}

export class ScopedGitCommitToolAdapter implements ToolAdapter<
  ScopedGitCommitToolInput,
  ScopedGitCommitToolOutput
> {
  readonly toolId: string;

  private readonly gitExecutablePath: string;
  private readonly terminal: ScopedTerminalToolAdapter;

  constructor(options: ScopedGitCommitToolAdapterOptions) {
    if (options.toolId.trim() === "") {
      throw new RangeError("toolId must not be empty.");
    }

    this.toolId = options.toolId;
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
    request: ToolInvocationRequest<ScopedGitCommitToolInput>,
  ): Promise<{ output: ScopedGitCommitToolOutput }> {
    const input = request.input;

    if (
      input === null ||
      typeof input !== "object" ||
      typeof input.message !== "string" ||
      input.message.trim() === "" ||
      input.message.length > 500
    ) {
      throw new ScopedGitCommitToolError(
        "INVALID_INPUT",
        "Git commit requires a non-empty message of at most 500 characters.",
      );
    }

    // Commit takes the whole index, so refuse when anything outside the scoped root is
    // staged. ":/" is the repository top and ":!." excludes the scoped root.
    let stagedOutsideRoot: string;
    try {
      const staged = await this.terminal.invoke({
        input: {
          command: this.gitExecutablePath,
          args: ["diff", "--cached", "--name-only", "-z", "--", ":/", ":!."],
          timeoutMs: input.timeoutMs,
        },
      });
      stagedOutsideRoot = staged.output.stdout;
    } catch (error) {
      throw new ScopedGitCommitToolError(
        "COMMAND_FAILED",
        error instanceof Error ? error.message : String(error),
      );
    }

    if (stagedOutsideRoot !== "") {
      throw new ScopedGitCommitToolError(
        "OUTSIDE_ROOT",
        "Git commit refused because changes outside the configured root are staged.",
      );
    }

    try {
      const result = await this.terminal.invoke({
        input: {
          command: this.gitExecutablePath,
          args: ["commit", "--message", input.message],
          timeoutMs: input.timeoutMs,
          maxOutputBytes: input.maxOutputBytes,
        },
      });

      return {
        output: {
          message: input.message,
          commandOutput: result.output,
        },
      };
    } catch (error) {
      throw new ScopedGitCommitToolError(
        "COMMAND_FAILED",
        error instanceof Error ? error.message : String(error),
      );
    }
  }
}
