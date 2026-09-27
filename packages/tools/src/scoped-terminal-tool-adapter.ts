/// <reference path="./node-runtime.d.ts" />

import { spawn } from "node:child_process";
import { existsSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";

import type { ToolAdapter, ToolInvocationRequest } from "./tool-adapter";

export interface ScopedTerminalToolInput {
  readonly command: string;
  readonly args?: readonly string[];
  readonly cwd?: string;
  readonly timeoutMs?: number;
  readonly maxOutputBytes?: number;
}

export interface ScopedTerminalToolOutput {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly exitCode: number | null;
  readonly signal?: string;
  readonly stdout: string;
  readonly stderr: string;
  readonly truncated: boolean;
  readonly durationMs: number;
}

export type ScopedTerminalToolErrorKind =
  | "INVALID_INPUT"
  | "COMMAND_NOT_ALLOWED"
  | "OUTSIDE_ROOT"
  | "NOT_FOUND"
  | "NOT_A_DIRECTORY"
  | "TIMEOUT"
  | "OUTPUT_TOO_LARGE"
  | "START_FAILED"
  | "NON_ZERO_EXIT";

export class ScopedTerminalToolError extends Error {
  readonly kind: ScopedTerminalToolErrorKind;
  readonly command: string;

  constructor(
    kind: ScopedTerminalToolErrorKind,
    command: string,
    message: string,
  ) {
    super(message);
    this.name = "ScopedTerminalToolError";
    this.kind = kind;
    this.command = command;
  }
}

export interface ScopedTerminalToolAdapterOptions {
  readonly toolId: string;
  readonly rootDir: string;
  readonly allowedCommands: readonly string[];
  readonly defaultTimeoutMs?: number;
  readonly maxTimeoutMs?: number;
  readonly defaultMaxOutputBytes?: number;
  readonly environmentKeys?: readonly string[];
}

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_OUTPUT_BYTES = 65_536;
const DEFAULT_ENVIRONMENT_KEYS = [
  "PATH",
  "HOME",
  "USER",
  "USERNAME",
  "SystemRoot",
  "ComSpec",
  "PATHEXT",
  "TEMP",
  "TMP",
] as const;

function assertPositiveInteger(value: number, field: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new RangeError(`${field} must be a positive integer.`);
  }
}

function assertCommandName(command: string): void {
  if (command.trim() === "") {
    throw new RangeError("command must not be empty.");
  }
}

function isPathInsideRoot(rootDir: string, candidatePath: string): boolean {
  const rel = relative(rootDir, candidatePath);
  return (
    rel === "" ||
    (!isAbsolute(rel) && rel !== ".." && !rel.startsWith(".." + sep))
  );
}

function normalizeAllowedCommands(commands: readonly string[]): ReadonlySet<string> {
  const normalized = new Set<string>();

  for (const command of commands) {
    if (command.trim() === "") {
      throw new RangeError("allowedCommands must not contain empty values.");
    }
    normalized.add(command);
  }

  return normalized;
}

function pickEnvironment(
  keys: readonly string[],
): Record<string, string | undefined> {
  const environment: Record<string, string | undefined> = {};
  const runtime = (
    globalThis as unknown as {
      readonly process?: {
        readonly env?: Readonly<Record<string, string | undefined>>;
      };
    }
  ).process;

  for (const key of keys) {
    const value = runtime?.env?.[key];
    if (value !== undefined) {
      environment[key] = value;
    }
  }

  return environment;
}

function decodeChunks(chunks: readonly Uint8Array[]): string {
  const totalBytes = chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
  const combined = new Uint8Array(totalBytes);
  let offset = 0;

  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return new TextDecoder().decode(combined);
}

export class ScopedTerminalToolAdapter
  implements ToolAdapter<ScopedTerminalToolInput, ScopedTerminalToolOutput>
{
  readonly toolId: string;

  private readonly rootDir: string;
  private readonly allowedCommands: ReadonlySet<string>;
  private readonly defaultTimeoutMs: number;
  private readonly maxTimeoutMs: number;
  private readonly defaultMaxOutputBytes: number;
  private readonly environmentKeys: readonly string[];

  constructor(options: ScopedTerminalToolAdapterOptions) {
    if (options.toolId.trim() === "") {
      throw new RangeError("toolId must not be empty.");
    }

    const defaultTimeoutMs = options.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS;
    const maxTimeoutMs = options.maxTimeoutMs ?? DEFAULT_MAX_TIMEOUT_MS;
    const defaultMaxOutputBytes =
      options.defaultMaxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;

    assertPositiveInteger(defaultTimeoutMs, "defaultTimeoutMs");
    assertPositiveInteger(maxTimeoutMs, "maxTimeoutMs");
    assertPositiveInteger(defaultMaxOutputBytes, "defaultMaxOutputBytes");

    if (maxTimeoutMs < defaultTimeoutMs) {
      throw new RangeError(
        "maxTimeoutMs must be greater than or equal to defaultTimeoutMs.",
      );
    }

    const absoluteRoot = resolve(options.rootDir);

    if (!existsSync(absoluteRoot)) {
      throw new ScopedTerminalToolError(
        "NOT_FOUND",
        "",
        `Terminal root does not exist: ${absoluteRoot}.`,
      );
    }

    if (!statSync(absoluteRoot).isDirectory()) {
      throw new ScopedTerminalToolError(
        "NOT_A_DIRECTORY",
        "",
        `Terminal root is not a directory: ${absoluteRoot}.`,
      );
    }

    this.toolId = options.toolId;
    this.rootDir = realpathSync(absoluteRoot);
    this.allowedCommands = normalizeAllowedCommands(options.allowedCommands);
    this.defaultTimeoutMs = defaultTimeoutMs;
    this.maxTimeoutMs = maxTimeoutMs;
    this.defaultMaxOutputBytes = defaultMaxOutputBytes;
    this.environmentKeys = options.environmentKeys ?? DEFAULT_ENVIRONMENT_KEYS;
  }

  async invoke(
    request: ToolInvocationRequest<ScopedTerminalToolInput>,
  ): Promise<{ output: ScopedTerminalToolOutput }> {
    const input = request.input;

    if (
      input === null ||
      typeof input !== "object" ||
      typeof input.command !== "string" ||
      input.command.trim() === ""
    ) {
      throw new ScopedTerminalToolError(
        "INVALID_INPUT",
        "",
        "Terminal execution requires a non-empty command.",
      );
    }

    const args = input.args ?? [];
    if (
      !Array.isArray(args) ||
      args.some((arg) => typeof arg !== "string")
    ) {
      throw new ScopedTerminalToolError(
        "INVALID_INPUT",
        input.command,
        "Terminal args must be an array of strings.",
      );
    }

    if (!this.allowedCommands.has(input.command)) {
      throw new ScopedTerminalToolError(
        "COMMAND_NOT_ALLOWED",
        input.command,
        `Terminal command is not allowlisted: ${input.command}.`,
      );
    }

    const timeoutMs = input.timeoutMs ?? this.defaultTimeoutMs;
    const maxOutputBytes =
      input.maxOutputBytes ?? this.defaultMaxOutputBytes;

    assertPositiveInteger(timeoutMs, "timeoutMs");
    assertPositiveInteger(maxOutputBytes, "maxOutputBytes");

    if (timeoutMs > this.maxTimeoutMs) {
      throw new ScopedTerminalToolError(
        "INVALID_INPUT",
        input.command,
        `Terminal timeout exceeds the configured maximum of ${this.maxTimeoutMs} ms.`,
      );
    }

    if (maxOutputBytes > this.defaultMaxOutputBytes) {
      throw new ScopedTerminalToolError(
        "INVALID_INPUT",
        input.command,
        `Terminal output limit exceeds the configured maximum of ${this.defaultMaxOutputBytes} bytes.`,
      );
    }

    const cwd = await this.resolveWorkingDirectory(input.cwd);

    return this.execute(
      input.command,
      args,
      cwd,
      timeoutMs,
      maxOutputBytes,
    );
  }

  private async resolveWorkingDirectory(cwdInput: string | undefined): Promise<string> {
    const requested = cwdInput === undefined ? this.rootDir : resolve(this.rootDir, cwdInput);

    if (!existsSync(requested)) {
      throw new ScopedTerminalToolError(
        "NOT_FOUND",
        "",
        `Terminal working directory does not exist: ${cwdInput ?? "."}.`,
      );
    }

    const resolved = realpathSync(requested);

    if (!isPathInsideRoot(this.rootDir, resolved)) {
      throw new ScopedTerminalToolError(
        "OUTSIDE_ROOT",
        "",
        `Terminal working directory escapes the configured root: ${cwdInput ?? "."}.`,
      );
    }

    if (!statSync(resolved).isDirectory()) {
      throw new ScopedTerminalToolError(
        "NOT_A_DIRECTORY",
        "",
        `Terminal working path is not a directory: ${cwdInput ?? "."}.`,
      );
    }

    return resolved;
  }

  private execute(
    command: string,
    args: readonly string[],
    cwd: string,
    timeoutMs: number,
    maxOutputBytes: number,
  ): Promise<{ output: ScopedTerminalToolOutput }> {
    const startedAt = Date.now();

    return new Promise((resolvePromise, rejectPromise) => {
      const child = spawn(command, [...args], {
        cwd,
        shell: false,
        windowsHide: true,
        env: pickEnvironment(this.environmentKeys),
        stdio: ["ignore", "pipe", "pipe"],
      });

      const stdoutChunks: Uint8Array[] = [];
      const stderrChunks: Uint8Array[] = [];
      let capturedBytes = 0;
      let truncated = false;
      let settled = false;
      let timeoutHandle: ReturnType<typeof globalThis.setTimeout> | undefined;

      const rejectOnce = (error: ScopedTerminalToolError): void => {
        if (settled) return;
        settled = true;
        if (timeoutHandle !== undefined) {
          globalThis.clearTimeout(timeoutHandle);
        }
        rejectPromise(error);
      };

      const onData = (target: Uint8Array[], chunk: Uint8Array): void => {
        if (settled) return;

        const remaining = maxOutputBytes - capturedBytes;

        if (chunk.byteLength <= remaining) {
          target.push(chunk);
          capturedBytes += chunk.byteLength;
          return;
        }

        if (remaining > 0) {
          target.push(chunk.subarray(0, remaining));
          capturedBytes += remaining;
        }

        truncated = true;
        child.kill();

        rejectOnce(
          new ScopedTerminalToolError(
            "OUTPUT_TOO_LARGE",
            command,
            `Terminal output exceeded the ${maxOutputBytes}-byte limit.`,
          ),
        );
      };

      child.stdout.on("data", (chunk: Buffer) => onData(stdoutChunks, chunk));
      child.stderr.on("data", (chunk: Buffer) => onData(stderrChunks, chunk));

      child.on("error", (error) => {
        rejectOnce(
          new ScopedTerminalToolError(
            "START_FAILED",
            command,
            `Unable to start terminal command: ${
              error instanceof Error ? error.message : "unknown error"
            }.`,
          ),
        );
      });

      timeoutHandle = globalThis.setTimeout(() => {
        truncated = false;
        child.kill();
        rejectOnce(
          new ScopedTerminalToolError(
            "TIMEOUT",
            command,
            `Terminal command timed out after ${timeoutMs} ms.`,
          ),
        );
      }, timeoutMs);

      child.on("close", (exitCode, signal) => {
        if (settled) return;
        settled = true;

        if (timeoutHandle !== undefined) {
          globalThis.clearTimeout(timeoutHandle);
        }

        const stdout = decodeChunks(stdoutChunks);
        const stderr = decodeChunks(stderrChunks);
        const durationMs = Date.now() - startedAt;

        const output: ScopedTerminalToolOutput = {
          command,
          args: [...args],
          cwd,
          exitCode,
          ...(signal === null ? {} : { signal }),
          stdout,
          stderr,
          truncated,
          durationMs,
        };

        if (exitCode !== 0) {
          rejectPromise(
            new ScopedTerminalToolError(
              "NON_ZERO_EXIT",
              command,
              `Terminal command exited with code ${exitCode ?? "unknown"}.`,
            ),
          );
          return;
        }

        resolvePromise({ output });
      });
    });
  }
}
