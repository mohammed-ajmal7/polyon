import { existsSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";

import type { ToolAdapter, ToolInvocationRequest } from "./tool-adapter";
import {
  ScopedTerminalToolAdapter,
  type ScopedTerminalToolOutput,
} from "./scoped-terminal-tool-adapter";

export type ScopedGitWriteOperation =
  | "CREATE_BRANCH"
  | "STAGE_PATHS"
  | "UNSTAGE_PATHS";

export interface ScopedGitWriteToolInput {
  readonly operation: ScopedGitWriteOperation;
  readonly branchName?: string;
  readonly paths?: readonly string[];
  readonly timeoutMs?: number;
  readonly maxOutputBytes?: number;
}

export interface ScopedGitWriteToolOutput {
  readonly operation: ScopedGitWriteOperation;
  readonly commandOutput: ScopedTerminalToolOutput;
}

export type ScopedGitWriteToolErrorKind =
  | "INVALID_INPUT"
  | "OUTSIDE_ROOT"
  | "INVALID_BRANCH"
  | "COMMAND_FAILED";

export class ScopedGitWriteToolError extends Error {
  readonly kind: ScopedGitWriteToolErrorKind;

  constructor(
    kind: ScopedGitWriteToolErrorKind,
    message: string,
  ) {
    super(message);
    this.name = "ScopedGitWriteToolError";
    this.kind = kind;
  }
}

export interface ScopedGitWriteToolAdapterOptions {
  readonly toolId: string;
  readonly rootDir: string;
  readonly gitExecutable?: string;
  readonly defaultTimeoutMs?: number;
  readonly maxTimeoutMs?: number;
  readonly defaultMaxOutputBytes?: number;
  readonly environmentKeys?: readonly string[];
}

const OPERATIONS: ReadonlySet<ScopedGitWriteOperation> = new Set([
  "CREATE_BRANCH",
  "STAGE_PATHS",
  "UNSTAGE_PATHS",
]);

export class ScopedGitWriteToolAdapter
  implements ToolAdapter<ScopedGitWriteToolInput, ScopedGitWriteToolOutput>
{
  readonly toolId: string;

  private readonly rootDir: string;
  private readonly gitExecutablePath: string;
  private readonly terminal: ScopedTerminalToolAdapter;

  constructor(options: ScopedGitWriteToolAdapterOptions) {
    if (options.toolId.trim() === "") {
      throw new RangeError("toolId must not be empty.");
    }

    const absoluteRoot = resolve(options.rootDir);

    if (!existsSync(absoluteRoot)) {
      throw new ScopedGitWriteToolError(
        "COMMAND_FAILED",
        `Git root does not exist: ${absoluteRoot}.`,
      );
    }

    if (!statSync(absoluteRoot).isDirectory()) {
      throw new ScopedGitWriteToolError(
        "COMMAND_FAILED",
        `Git root is not a directory: ${absoluteRoot}.`,
      );
    }

    this.toolId = options.toolId;
    this.rootDir = realpathSync(absoluteRoot);
    this.gitExecutablePath = options.gitExecutable ?? "git";
    this.terminal = new ScopedTerminalToolAdapter({
      toolId: options.toolId,
      rootDir: this.rootDir,
      allowedCommands: [this.gitExecutablePath],
      defaultTimeoutMs: options.defaultTimeoutMs,
      maxTimeoutMs: options.maxTimeoutMs,
      defaultMaxOutputBytes: options.defaultMaxOutputBytes,
      environmentKeys: options.environmentKeys,
    });
  }

  async invoke(
    request: ToolInvocationRequest<ScopedGitWriteToolInput>,
  ): Promise<{ output: ScopedGitWriteToolOutput }> {
    const input = request.input;

    if (
      input === null ||
      typeof input !== "object" ||
      !OPERATIONS.has(input.operation)
    ) {
      throw new ScopedGitWriteToolError(
        "INVALID_INPUT",
        "Git write requires CREATE_BRANCH, STAGE_PATHS, or UNSTAGE_PATHS.",
      );
    }

    if (input.operation === "CREATE_BRANCH") {
      if (
        typeof input.branchName !== "string" ||
        !isSafeBranchName(input.branchName)
      ) {
        throw new ScopedGitWriteToolError(
          "INVALID_BRANCH",
          "Git branch names must use a restricted safe format.",
        );
      }
    } else {
      validatePaths(this.rootDir, input.paths);
    }

    try {
      const result = await this.terminal.invoke({
        input: {
          command: this.gitExecutablePath,
          args: buildArgs(input),
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
      throw new ScopedGitWriteToolError(
        "COMMAND_FAILED",
        error instanceof Error ? error.message : String(error),
      );
    }
  }
}

function buildArgs(input: ScopedGitWriteToolInput): readonly string[] {
  switch (input.operation) {
    case "CREATE_BRANCH":
      return ["branch", "--", input.branchName!];
    case "STAGE_PATHS":
      return ["add", "--", ...input.paths!.map(normalizeRelativePath)];
    case "UNSTAGE_PATHS":
      return ["restore", "--staged", "--", ...input.paths!.map(normalizeRelativePath)];
  }
}

function validatePaths(rootDir: string, paths: readonly string[] | undefined): void {
  if (
    paths === undefined ||
    paths.length === 0 ||
    paths.some((path) => typeof path !== "string" || path.trim() === "")
  ) {
    throw new ScopedGitWriteToolError(
      "INVALID_INPUT",
      "Git write requires at least one non-empty relative path.",
    );
  }

  for (const path of paths) {
    const candidate = resolve(rootDir, path);
    const normalized = realpathIfExists(candidate);

    if (!isInsideRoot(rootDir, normalized)) {
      throw new ScopedGitWriteToolError(
        "OUTSIDE_ROOT",
        `Git path escapes the configured root: ${path}.`,
      );
    }
  }
}

function normalizeRelativePath(path: string): string {
  return path.split(sep).join("/");
}

function realpathIfExists(candidate: string): string {
  return existsSync(candidate) ? realpathSync(candidate) : candidate;
}

function isInsideRoot(rootDir: string, candidate: string): boolean {
  const rel = relative(rootDir, candidate);
  return (
    rel === "" ||
    (!isAbsolute(rel) && rel !== ".." && !rel.startsWith(".." + sep))
  );
}

function isSafeBranchName(value: string): boolean {
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
