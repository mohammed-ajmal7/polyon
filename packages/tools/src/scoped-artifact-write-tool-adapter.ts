import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import {
  dirname,
  isAbsolute,
  relative,
  resolve,
  sep,
} from "node:path";

import type { ArtifactKind, ArtifactStatus } from "@polyon/contracts";
import type { ToolAdapter, ToolInvocationRequest } from "./tool-adapter";

export interface ScopedArtifactWriteToolInput {
  readonly name: string;
  readonly content: string;
  readonly kind?: ArtifactKind;
  readonly mimeType?: string;
}

export interface ScopedArtifactWriteToolOutput {
  readonly artifactId: string;
  readonly name: string;
  readonly kind: ArtifactKind;
  readonly mimeType?: string;
  readonly location: string;
  readonly status: ArtifactStatus;
  readonly sizeBytes: number;
  readonly sha256: string;
  readonly created: boolean;
}

export type ScopedArtifactWriteToolErrorKind =
  | "INVALID_INPUT"
  | "OUTSIDE_ROOT"
  | "PATH_CONFLICT"
  | "WRITE_FAILED";

export class ScopedArtifactWriteToolError extends Error {
  readonly kind: ScopedArtifactWriteToolErrorKind;

  constructor(
    kind: ScopedArtifactWriteToolErrorKind,
    message: string,
  ) {
    super(message);
    this.name = "ScopedArtifactWriteToolError";
    this.kind = kind;
  }
}

export interface ScopedArtifactWriteToolAdapterOptions {
  readonly toolId: string;
  readonly rootDir: string;
  readonly defaultKind?: ArtifactKind;
}

export class ScopedArtifactWriteToolAdapter
  implements
    ToolAdapter<
      ScopedArtifactWriteToolInput,
      ScopedArtifactWriteToolOutput
    >
{
  readonly toolId: string;

  private readonly rootDir: string;
  private readonly defaultKind: ArtifactKind;

  constructor(options: ScopedArtifactWriteToolAdapterOptions) {
    if (options.toolId.trim() === "") {
      throw new RangeError("toolId must not be empty.");
    }

    const root = resolve(options.rootDir);

    if (!existsSync(root) || !statSync(root).isDirectory()) {
      throw new ScopedArtifactWriteToolError(
        "WRITE_FAILED",
        `Artifact root must be an existing directory: ${root}.`,
      );
    }

    this.toolId = options.toolId;
    this.rootDir = realpathSync(root);
    this.defaultKind = options.defaultKind ?? "DOCUMENT";
  }

  async invoke(
    request: ToolInvocationRequest<ScopedArtifactWriteToolInput>,
  ): Promise<{ output: ScopedArtifactWriteToolOutput }> {
    const input = request.input;

    if (
      input === null ||
      typeof input !== "object" ||
      typeof input.name !== "string" ||
      input.name.trim() === "" ||
      typeof input.content !== "string"
    ) {
      throw new ScopedArtifactWriteToolError(
        "INVALID_INPUT",
        "Artifact write requires a non-empty name and string content.",
      );
    }

    const kind = input.kind ?? this.defaultKind;
    const target = this.resolveArtifactPath(input.name);
    const artifactId =
      "artifact:" +
      createHash("sha256").update(target + "\n" + input.content).digest("hex");

    const existing = readExisting(target);

    if (existing !== undefined) {
      const existingSha = sha256(existing);

      if (existingSha === sha256(input.content)) {
        return {
          output: {
            artifactId,
            name: input.name,
            kind,
            ...(input.mimeType === undefined
              ? {}
              : { mimeType: input.mimeType }),
            location: target,
            status: "AVAILABLE",
            sizeBytes: Buffer.byteLength(existing, "utf8"),
            sha256: existingSha,
            created: false,
          },
        };
      }

      throw new ScopedArtifactWriteToolError(
        "PATH_CONFLICT",
        `Artifact path already exists with different content: ${input.name}.`,
      );
    }

    const parent = dirname(target);
    mkdirSync(parent, { recursive: true });

    const tempPath = `${target}.${randomUUID()}.tmp`;

    try {
      writeFileSync(tempPath, input.content, "utf8");
      const descriptor = openSync(tempPath, "r");

      try {
        fsyncSync(descriptor);
      } finally {
        closeSync(descriptor);
      }

      renameSync(tempPath, target);
    } catch (error) {
      try {
        unlinkSync(tempPath);
      } catch {
        // Preserve the original write failure.
      }

      throw new ScopedArtifactWriteToolError(
        "WRITE_FAILED",
        error instanceof Error ? error.message : String(error),
      );
    }

    const persisted = readFileSync(target, "utf8");

    return {
      output: {
        artifactId,
        name: input.name,
        kind,
        ...(input.mimeType === undefined
          ? {}
          : { mimeType: input.mimeType }),
        location: target,
        status: "AVAILABLE",
        sizeBytes: Buffer.byteLength(persisted, "utf8"),
        sha256: sha256(persisted),
        created: true,
      },
    };
  }

  private resolveArtifactPath(name: string): string {
    if (
      isAbsolute(name) ||
      name.split(/[\\/]/).some((segment) => segment === "..")
    ) {
      throw new ScopedArtifactWriteToolError(
        "OUTSIDE_ROOT",
        `Artifact path must remain inside the configured root: ${name}.`,
      );
    }

    const candidate = resolve(this.rootDir, name);
    const existing = existsSync(candidate)
      ? realpathSync(candidate)
      : candidate;

    if (!isInsideRoot(this.rootDir, existing)) {
      throw new ScopedArtifactWriteToolError(
        "OUTSIDE_ROOT",
        `Artifact path escapes the configured root: ${name}.`,
      );
    }

    const parent = dirname(candidate);
    const parentRealPath = existsSync(parent)
      ? realpathSync(parent)
      : this.rootDir;

    if (!isInsideRoot(this.rootDir, parentRealPath)) {
      throw new ScopedArtifactWriteToolError(
        "OUTSIDE_ROOT",
        `Artifact parent escapes the configured root: ${name}.`,
      );
    }

    return candidate;
  }
}

function readExisting(path: string): string | undefined {
  if (!existsSync(path)) {
    return undefined;
  }

  if (!statSync(path).isFile()) {
    throw new ScopedArtifactWriteToolError(
      "PATH_CONFLICT",
      `Artifact target is not a regular file: ${path}.`,
    );
  }

  return readFileSync(path, "utf8");
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function isInsideRoot(rootDir: string, candidate: string): boolean {
  const rel = relative(rootDir, candidate);

  return (
    rel === "" ||
    (!isAbsolute(rel) && rel !== ".." && !rel.startsWith(".." + sep))
  );
}
