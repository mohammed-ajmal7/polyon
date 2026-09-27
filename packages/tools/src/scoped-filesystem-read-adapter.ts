/// <reference path="./node-runtime.d.ts" />

import { closeSync, existsSync, openSync, readSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";

import type { ToolAdapter, ToolInvocationRequest } from "./tool-adapter";

export interface FilesystemReadToolInput {
  readonly path: string;
  readonly maxBytes?: number;
}

export interface FilesystemReadToolOutput {
  readonly path: string;
  readonly content: string;
  readonly sizeBytes: number;
}

export type FilesystemReadToolErrorKind =
  "INVALID_INPUT" | "OUTSIDE_ROOT" | "NOT_FOUND" | "NOT_A_FILE" | "FILE_TOO_LARGE";

export class FilesystemReadToolError extends Error {
  readonly kind: FilesystemReadToolErrorKind;
  readonly path: string;

  constructor(kind: FilesystemReadToolErrorKind, path: string, message: string) {
    super(message);
    this.name = "FilesystemReadToolError";
    this.kind = kind;
    this.path = path;
  }
}

export interface FilesystemReadToolAdapterOptions {
  readonly toolId: string;
  readonly rootDir: string;
  readonly defaultMaxBytes?: number;
}

const DEFAULT_MAX_BYTES = 1_048_576;

function assertPositiveByteLimit(value: number, field: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new RangeError(`${field} must be a positive integer.`);
  }
}

function isPathInsideRoot(rootDir: string, candidatePath: string): boolean {
  const rel = relative(rootDir, candidatePath);
  return rel === "" || (!isAbsolute(rel) && rel !== ".." && !rel.startsWith(".." + sep));
}

export class ScopedFilesystemReadToolAdapter implements ToolAdapter<
  FilesystemReadToolInput,
  FilesystemReadToolOutput
> {
  readonly toolId: string;
  private readonly rootDir: string;
  private readonly defaultMaxBytes: number;

  constructor(options: FilesystemReadToolAdapterOptions) {
    if (options.toolId.trim() === "") {
      throw new RangeError("toolId must not be empty.");
    }

    assertPositiveByteLimit(options.defaultMaxBytes ?? DEFAULT_MAX_BYTES, "defaultMaxBytes");

    const absoluteRoot = resolve(options.rootDir);

    if (!existsSync(absoluteRoot)) {
      throw new FilesystemReadToolError(
        "NOT_FOUND",
        absoluteRoot,
        `Filesystem root does not exist: ${absoluteRoot}.`,
      );
    }

    const rootStats = statSync(absoluteRoot);

    if (!rootStats.isDirectory()) {
      throw new FilesystemReadToolError(
        "NOT_A_FILE",
        absoluteRoot,
        `Filesystem root is not a directory: ${absoluteRoot}.`,
      );
    }

    this.toolId = options.toolId;
    this.rootDir = realpathSync(absoluteRoot);
    this.defaultMaxBytes = options.defaultMaxBytes ?? DEFAULT_MAX_BYTES;
  }

  async invoke(
    request: ToolInvocationRequest<FilesystemReadToolInput>,
  ): Promise<{ output: FilesystemReadToolOutput }> {
    const input = request.input;

    if (
      input === null ||
      typeof input !== "object" ||
      typeof input.path !== "string" ||
      input.path.trim() === ""
    ) {
      throw new FilesystemReadToolError(
        "INVALID_INPUT",
        "",
        "Filesystem read requires a non-empty path.",
      );
    }

    const maxBytes = input.maxBytes ?? this.defaultMaxBytes;
    assertPositiveByteLimit(maxBytes, "maxBytes");

    const requestedPath = resolve(this.rootDir, input.path);
    const resolvedPath = this.resolveExistingPath(requestedPath);

    if (!isPathInsideRoot(this.rootDir, resolvedPath)) {
      throw new FilesystemReadToolError(
        "OUTSIDE_ROOT",
        input.path,
        `Filesystem path escapes the configured root: ${input.path}.`,
      );
    }

    const stats = statSync(resolvedPath);

    if (!stats.isFile()) {
      throw new FilesystemReadToolError(
        "NOT_A_FILE",
        input.path,
        `Filesystem path is not a regular file: ${input.path}.`,
      );
    }

    if (stats.size > maxBytes) {
      throw new FilesystemReadToolError(
        "FILE_TOO_LARGE",
        input.path,
        `Filesystem file exceeds the ${maxBytes}-byte read limit: ${input.path}.`,
      );
    }

    const fileDescriptor = openSync(resolvedPath, "r");

    try {
      const buffer = new Uint8Array(maxBytes + 1);
      const bytesRead = readSync(fileDescriptor, buffer, 0, buffer.length, 0);

      if (bytesRead > maxBytes) {
        throw new FilesystemReadToolError(
          "FILE_TOO_LARGE",
          input.path,
          `Filesystem file exceeds the ${maxBytes}-byte read limit: ${input.path}.`,
        );
      }

      const content = new TextDecoder().decode(buffer.subarray(0, bytesRead));

      return {
        output: {
          path: relative(this.rootDir, resolvedPath),
          content,
          sizeBytes: bytesRead,
        },
      };
    } finally {
      closeSync(fileDescriptor);
    }
  }

  private resolveExistingPath(requestedPath: string): string {
    if (!existsSync(requestedPath)) {
      throw new FilesystemReadToolError(
        "NOT_FOUND",
        requestedPath,
        `Filesystem path does not exist: ${requestedPath}.`,
      );
    }

    return realpathSync(requestedPath);
  }
}
