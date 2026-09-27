import type { ToolAdapter, ToolInvocationRequest } from "./tool-adapter";
import {
  ScopedTerminalToolAdapter,
  type ScopedTerminalToolOutput,
} from "./scoped-terminal-tool-adapter";

export type ScopedGitReadOperation =
  | "STATUS"
  | "DIFF"
  | "LOG"
  | "SHOW";

export interface ScopedGitReadToolInput {
  readonly operation: ScopedGitReadOperation;
  readonly maxOutputBytes?: number;
  readonly timeoutMs?: number;
}

export interface ScopedGitReadToolOutput {
  readonly operation: ScopedGitReadOperation;
  readonly commandOutput: ScopedTerminalToolOutput;
}

export type ScopedGitReadToolErrorKind =
  | "INVALID_INPUT"
  | "OUTSIDE_ROOT"
  | "COMMAND_FAILED";

export class ScopedGitReadToolError extends Error {
  readonly kind: ScopedGitReadToolErrorKind;

  constructor(
    kind: ScopedGitReadToolErrorKind,
    message: string,
  ) {
    super(message);
    this.name = "ScopedGitReadToolError";
    this.kind = kind;
  }
}

export interface ScopedGitReadToolAdapterOptions {
  readonly toolId: string;
  readonly rootDir: string;
  readonly gitExecutable?: string;
  readonly defaultTimeoutMs?: number;
  readonly maxTimeoutMs?: number;
  readonly defaultMaxOutputBytes?: number;
  readonly environmentKeys?: readonly string[];
}

const OPERATION_ARGS: Readonly<
  Record<ScopedGitReadOperation, readonly string[]>
> = {
  STATUS: ["status", "--short", "--branch"],
  DIFF: ["diff", "--no-ext-diff", "--no-color"],
  LOG: ["log", "--oneline", "-20"],
  SHOW: ["show", "--stat", "--oneline", "HEAD"],
};

export class ScopedGitReadToolAdapter
  implements ToolAdapter<ScopedGitReadToolInput, ScopedGitReadToolOutput>
{
  readonly toolId: string;

  private readonly terminal: ScopedTerminalToolAdapter;
  private readonly gitExecutablePath: string;

  constructor(options: ScopedGitReadToolAdapterOptions) {
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
    request: ToolInvocationRequest<ScopedGitReadToolInput>,
  ): Promise<{ output: ScopedGitReadToolOutput }> {
    const input = request.input;

    if (
      input === null ||
      typeof input !== "object" ||
      !isGitOperation(input.operation)
    ) {
      throw new ScopedGitReadToolError(
        "INVALID_INPUT",
        "Git read requires one of: STATUS, DIFF, LOG, SHOW.",
      );
    }

    const args = OPERATION_ARGS[input.operation];

    try {
      const result = await this.terminal.invoke({
        input: {
          command: this.gitExecutable(),
          args,
          timeoutMs: input.timeoutMs,
          maxOutputBytes: input.maxOutputBytes,
        },
      });

      return {
        output: {
          operation: input.operation,
          commandOutput: result.output,
        },
      };
    } catch (error) {
      if (
        error instanceof Error &&
        "kind" in error &&
        typeof error.kind === "string" &&
        error.kind === "OUTSIDE_ROOT"
      ) {
        throw new ScopedGitReadToolError(
          "OUTSIDE_ROOT",
          error.message,
        );
      }

      throw new ScopedGitReadToolError(
        "COMMAND_FAILED",
        error instanceof Error ? error.message : String(error),
      );
    }
  }


}

function isGitOperation(value: unknown): value is ScopedGitReadOperation {
  return (
    value === "STATUS" ||
    value === "DIFF" ||
    value === "LOG" ||
    value === "SHOW"
  );
}

