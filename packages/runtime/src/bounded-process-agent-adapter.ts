/// <reference types="node" />

import { spawn } from "node:child_process";
import { existsSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";

export interface BoundedProcessAgentRequest {
  readonly executable: string;
  readonly args?: readonly string[];
  readonly input: string;
  readonly cwd?: string;
  readonly timeoutMs?: number;
  readonly maxOutputBytes?: number;
}

export interface BoundedProcessAgentResponse {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number | null;
  readonly signal?: string;
  readonly durationMs: number;
}

export interface BoundedProcessAgentAdapterOptions {
  readonly rootDir: string;
  readonly allowedExecutables: readonly string[];
  readonly defaultTimeoutMs?: number;
  readonly maxTimeoutMs?: number;
  readonly defaultMaxOutputBytes?: number;
  readonly maxInputBytes?: number;
  readonly environmentKeys?: readonly string[];
}

export type BoundedProcessAgentErrorKind =
  | "INVALID_INPUT"
  | "EXECUTABLE_NOT_ALLOWED"
  | "OUTSIDE_ROOT"
  | "NOT_FOUND"
  | "NOT_A_DIRECTORY"
  | "TIMEOUT"
  | "OUTPUT_TOO_LARGE"
  | "START_FAILED"
  | "NON_ZERO_EXIT";

export class BoundedProcessAgentError extends Error {
  readonly kind: BoundedProcessAgentErrorKind;
  readonly executable: string;

  constructor(kind: BoundedProcessAgentErrorKind, executable: string, message: string) {
    super(message);
    this.name = "BoundedProcessAgentError";
    this.kind = kind;
    this.executable = executable;
  }
}

const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_TIMEOUT_MS = 300_000;
const DEFAULT_MAX_OUTPUT_BYTES = 256_000;
const MAX_INPUT_BYTES = 512_000;

export class BoundedProcessAgentAdapter {
  private readonly rootDir: string;
  private readonly allowedExecutables: ReadonlySet<string>;
  private readonly defaultTimeoutMs: number;
  private readonly maxTimeoutMs: number;
  private readonly defaultMaxOutputBytes: number;
  private readonly maxInputBytes: number;
  private readonly environmentKeys: readonly string[];

  constructor(options: BoundedProcessAgentAdapterOptions) {
    const defaultTimeoutMs = options.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS;
    const maxTimeoutMs = options.maxTimeoutMs ?? MAX_TIMEOUT_MS;
    const defaultMaxOutputBytes = options.defaultMaxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
    const maxInputBytes = options.maxInputBytes ?? MAX_INPUT_BYTES;

    assertPositiveInteger(defaultTimeoutMs, "defaultTimeoutMs");
    assertPositiveInteger(maxTimeoutMs, "maxTimeoutMs");
    assertPositiveInteger(defaultMaxOutputBytes, "defaultMaxOutputBytes");
    assertPositiveInteger(maxInputBytes, "maxInputBytes");

    if (maxTimeoutMs < defaultTimeoutMs) {
      throw new RangeError("maxTimeoutMs must be greater than or equal to defaultTimeoutMs.");
    }
    if (maxInputBytes > MAX_INPUT_BYTES) {
      throw new RangeError(`maxInputBytes cannot exceed ${MAX_INPUT_BYTES} bytes.`);
    }

    const absoluteRoot = resolve(options.rootDir);
    if (!existsSync(absoluteRoot)) {
      throw new BoundedProcessAgentError(
        "NOT_FOUND",
        "",
        `Agent root does not exist: ${absoluteRoot}.`,
      );
    }
    if (!statSync(absoluteRoot).isDirectory()) {
      throw new BoundedProcessAgentError(
        "NOT_A_DIRECTORY",
        "",
        `Agent root is not a directory: ${absoluteRoot}.`,
      );
    }

    this.rootDir = realpathSync(absoluteRoot);
    this.allowedExecutables = normalizeAllowedExecutables(options.allowedExecutables);
    this.defaultTimeoutMs = defaultTimeoutMs;
    this.maxTimeoutMs = maxTimeoutMs;
    this.defaultMaxOutputBytes = defaultMaxOutputBytes;
    this.maxInputBytes = maxInputBytes;
    this.environmentKeys = options.environmentKeys ?? [
      "PATH",
      "HOME",
      "USER",
      "USERNAME",
      "SystemRoot",
      "ComSpec",
      "PATHEXT",
      "TEMP",
      "TMP",
    ];
  }

  async invoke(request: BoundedProcessAgentRequest): Promise<BoundedProcessAgentResponse> {
    const executable = request.executable.trim();
    if (executable === "") {
      throw new BoundedProcessAgentError(
        "INVALID_INPUT",
        "",
        "Agent executable must not be empty.",
      );
    }
    if (!this.allowedExecutables.has(executable)) {
      throw new BoundedProcessAgentError(
        "EXECUTABLE_NOT_ALLOWED",
        executable,
        `Agent executable is not allowlisted: ${executable}.`,
      );
    }

    const args = request.args ?? [];
    if (!Array.isArray(args) || args.some((arg) => typeof arg !== "string")) {
      throw new BoundedProcessAgentError(
        "INVALID_INPUT",
        executable,
        "Agent args must be an array of strings.",
      );
    }

    const inputBytes = new TextEncoder().encode(request.input);
    if (inputBytes.byteLength > this.maxInputBytes) {
      throw new BoundedProcessAgentError(
        "INVALID_INPUT",
        executable,
        `Agent input exceeds the ${this.maxInputBytes}-byte limit.`,
      );
    }

    const cwd = this.resolveWorkingDirectory(request.cwd);
    const timeoutMs = request.timeoutMs ?? this.defaultTimeoutMs;
    const maxOutputBytes = request.maxOutputBytes ?? this.defaultMaxOutputBytes;

    assertPositiveInteger(timeoutMs, "timeoutMs");
    assertPositiveInteger(maxOutputBytes, "maxOutputBytes");
    if (timeoutMs > this.maxTimeoutMs) {
      throw new BoundedProcessAgentError(
        "INVALID_INPUT",
        executable,
        `Agent timeout exceeds the ${this.maxTimeoutMs}-millisecond limit.`,
      );
    }

    const startedAt = Date.now();
    const child = spawn(executable, [...args], {
      cwd,
      shell: false,
      windowsHide: true,
      env: pickEnvironment(this.environmentKeys),
      stdio: ["pipe", "pipe", "pipe"],
    });

    let timedOut = false;
    let settled = false;
    let stdoutBytes = 0;
    let stderrBytes = 0;
    const stdoutChunks: Uint8Array[] = [];
    const stderrChunks: Uint8Array[] = [];

    const result = await new Promise<BoundedProcessAgentResponse>((resolveResult, rejectResult) => {
      let childExitCode: number | null = null;
      let childSignal: string | null = null;

      const finishError = (error: BoundedProcessAgentError): void => {
        if (settled) return;
        settled = true;
        rejectResult(error);
      };

      const timeout = setTimeout(() => {
        timedOut = true;
        child.kill("SIGTERM");
        finishError(
          new BoundedProcessAgentError(
            "TIMEOUT",
            executable,
            `Agent process exceeded the ${timeoutMs}-millisecond timeout.`,
          ),
        );
      }, timeoutMs);

      const finish = (error?: unknown): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);

        if (error !== undefined) {
          rejectResult(
            new BoundedProcessAgentError("START_FAILED", executable, "Agent process failed."),
          );
          return;
        }

        const stdout = decode(stdoutChunks);
        const stderr = decode(stderrChunks);
        const exitCode = childExitCode;

        if (timedOut) return;
        if (exitCode !== 0) {
          rejectResult(
            new BoundedProcessAgentError(
              "NON_ZERO_EXIT",
              executable,
              "Agent process exited unsuccessfully.",
            ),
          );
          return;
        }

        resolveResult({
          stdout,
          stderr,
          exitCode,
          ...(childSignal === null ? {} : { signal: childSignal }),
          durationMs: Date.now() - startedAt,
        });
      };

      child.once("error", (error) => finish(error));
      child.once("close", (exitCode, signal) => {
        childExitCode = exitCode;
        childSignal = signal;
        finish();
      });
      child.stdout.on("data", (chunk: Uint8Array) => {
        stdoutBytes += chunk.byteLength;
        if (stdoutBytes > maxOutputBytes) {
          child.kill("SIGTERM");
          finishError(
            new BoundedProcessAgentError(
              "OUTPUT_TOO_LARGE",
              executable,
              `Agent output exceeds the ${maxOutputBytes}-byte limit.`,
            ),
          );
          return;
        }
        stdoutChunks.push(chunk);
      });
      child.stderr.on("data", (chunk: Uint8Array) => {
        stderrBytes += chunk.byteLength;
        if (stdoutBytes + stderrBytes > maxOutputBytes) {
          child.kill("SIGTERM");
          finishError(
            new BoundedProcessAgentError(
              "OUTPUT_TOO_LARGE",
              executable,
              `Agent output exceeds the ${maxOutputBytes}-byte limit.`,
            ),
          );
          return;
        }
        stderrChunks.push(chunk);
      });

      child.stdin.on("error", () => {
        finishError(
          new BoundedProcessAgentError("START_FAILED", executable, "Agent input failed."),
        );
      });
      child.stdin.end(request.input);
    });

    return result;
  }

  private resolveWorkingDirectory(cwd: string | undefined): string {
    const candidate = resolve(this.rootDir, cwd ?? ".");
    if (!isInsideRoot(this.rootDir, candidate)) {
      throw new BoundedProcessAgentError(
        "OUTSIDE_ROOT",
        "",
        "Agent working directory is outside the configured root.",
      );
    }

    if (!existsSync(candidate)) {
      throw new BoundedProcessAgentError(
        "NOT_FOUND",
        "",
        `Agent working directory does not exist: ${candidate}.`,
      );
    }
    if (!statSync(candidate).isDirectory()) {
      throw new BoundedProcessAgentError(
        "NOT_A_DIRECTORY",
        "",
        `Agent working directory is not a directory: ${candidate}.`,
      );
    }

    return realpathSync(candidate);
  }
}

function normalizeAllowedExecutables(values: readonly string[]): ReadonlySet<string> {
  const normalized = new Set<string>();
  for (const value of values) {
    const item = value.trim();
    if (item === "") throw new RangeError("allowedExecutables must not contain empty values.");
    normalized.add(item);
  }
  return normalized;
}

function isInsideRoot(rootDir: string, candidate: string): boolean {
  const rel = relative(rootDir, candidate);
  return rel === "" || (!isAbsolute(rel) && rel !== ".." && !rel.startsWith(".." + sep));
}

function assertPositiveInteger(value: number, field: string): void {
  if (!Number.isInteger(value) || value <= 0)
    throw new RangeError(`${field} must be a positive integer.`);
}

function pickEnvironment(keys: readonly string[]): Record<string, string | undefined> {
  const runtime = globalThis as unknown as {
    readonly process?: { readonly env?: Readonly<Record<string, string | undefined>> };
  };
  const env: Record<string, string | undefined> = {};
  for (const key of keys) {
    const value = runtime.process?.env?.[key];
    if (value !== undefined) env[key] = value;
  }
  return env;
}

function decode(chunks: readonly Uint8Array[]): string {
  let size = 0;
  for (const chunk of chunks) size += chunk.byteLength;
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}
