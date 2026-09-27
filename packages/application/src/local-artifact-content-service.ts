import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { createHash } from "node:crypto";

import type { Artifact, ArtifactId } from "@polyon/contracts";
import type { ArtifactStore } from "@polyon/storage";

export interface LocalArtifactContentServiceOptions {
  readonly rootDir: string;
  readonly maxBytes?: number;
}

export interface LocalArtifactContent {
  readonly artifact: Artifact;
  readonly content: string;
  readonly sizeBytes: number;
  readonly sha256: string;
}

export type LocalArtifactContentServiceErrorKind =
  | "ARTIFACT_NOT_FOUND"
  | "INVALID_ROOT"
  | "OUTSIDE_ROOT"
  | "NOT_A_FILE"
  | "FILE_NOT_FOUND"
  | "FILE_TOO_LARGE"
  | "READ_FAILED";

export class LocalArtifactContentServiceError extends Error {
  readonly kind: LocalArtifactContentServiceErrorKind;

  constructor(kind: LocalArtifactContentServiceErrorKind, message: string) {
    super(message);
    this.name = "LocalArtifactContentServiceError";
    this.kind = kind;
  }
}

export interface LocalArtifactContentServiceDependencies {
  readonly artifacts: ArtifactStore;
  readonly options: LocalArtifactContentServiceOptions;
}

export class LocalArtifactContentService {
  private readonly rootDir: string;
  private readonly maxBytes: number;

  constructor(private readonly dependencies: LocalArtifactContentServiceDependencies) {
    const root = resolve(dependencies.options.rootDir);
    const maxBytes = dependencies.options.maxBytes ?? 1_048_576;

    if (!existsSync(root) || !statSync(root).isDirectory()) {
      throw new LocalArtifactContentServiceError(
        "INVALID_ROOT",
        `Artifact content root must be an existing directory: ${root}.`,
      );
    }

    if (!Number.isInteger(maxBytes) || maxBytes <= 0) {
      throw new RangeError("maxBytes must be a positive integer.");
    }

    this.rootDir = realpathSync(root);
    this.maxBytes = maxBytes;
  }

  read(id: ArtifactId, maxBytes = this.maxBytes): LocalArtifactContent {
    if (!Number.isInteger(maxBytes) || maxBytes <= 0) {
      throw new RangeError("maxBytes must be a positive integer.");
    }

    const artifact = this.dependencies.artifacts.get(id);

    if (artifact === undefined) {
      throw new LocalArtifactContentServiceError(
        "ARTIFACT_NOT_FOUND",
        `Artifact not found: ${id}.`,
      );
    }

    if (artifact.status !== "AVAILABLE") {
      throw new LocalArtifactContentServiceError(
        "READ_FAILED",
        `Artifact ${id} is not available for reading: ${artifact.status}.`,
      );
    }

    const location = artifact.location;
    const candidate = isAbsolute(location) ? location : resolve(this.rootDir, location);
    const resolved = existsSync(candidate) ? realpathSync(candidate) : candidate;

    if (!isInsideRoot(this.rootDir, resolved)) {
      throw new LocalArtifactContentServiceError(
        "OUTSIDE_ROOT",
        `Artifact location escapes the configured local root: ${location}.`,
      );
    }

    if (!existsSync(resolved)) {
      throw new LocalArtifactContentServiceError(
        "FILE_NOT_FOUND",
        `Artifact file does not exist: ${location}.`,
      );
    }

    if (!statSync(resolved).isFile()) {
      throw new LocalArtifactContentServiceError(
        "NOT_A_FILE",
        `Artifact location is not a regular file: ${location}.`,
      );
    }

    const sizeBytes = statSync(resolved).size;

    if (sizeBytes > maxBytes) {
      throw new LocalArtifactContentServiceError(
        "FILE_TOO_LARGE",
        `Artifact exceeds the ${maxBytes}-byte read limit: ${location}.`,
      );
    }

    try {
      const content = readFileSync(resolved, "utf8");

      return {
        artifact,
        content,
        sizeBytes: byteLength(content),
        sha256: sha256(content),
      };
    } catch (error) {
      throw new LocalArtifactContentServiceError(
        "READ_FAILED",
        error instanceof Error ? error.message : String(error),
      );
    }
  }
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function isInsideRoot(rootDir: string, candidate: string): boolean {
  const rel = relative(rootDir, candidate);

  return rel === "" || (!isAbsolute(rel) && rel !== ".." && !rel.startsWith(".." + sep));
}
