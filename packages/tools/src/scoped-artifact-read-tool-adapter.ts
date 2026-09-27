import type { Artifact, ArtifactId } from "@polyon/contracts";
import type { ToolAdapter, ToolInvocationRequest } from "./tool-adapter";

export interface ArtifactReadToolInput {
  readonly artifactId: ArtifactId;
  readonly maxBytes?: number;
}

export interface ArtifactReadToolOutput {
  readonly artifact: Artifact;
  readonly content: string;
  readonly sizeBytes: number;
  readonly sha256: string;
}

export interface ArtifactReadToolResolution {
  readonly artifact: Artifact;
  readonly content: string;
  readonly sizeBytes: number;
  readonly sha256: string;
}

export type ArtifactReadToolErrorKind =
  "INVALID_INPUT" | "ARTIFACT_NOT_FOUND" | "CONTENT_READ_FAILED";

export class ArtifactReadToolError extends Error {
  readonly kind: ArtifactReadToolErrorKind;

  constructor(kind: ArtifactReadToolErrorKind, message: string) {
    super(message);
    this.name = "ArtifactReadToolError";
    this.kind = kind;
  }
}

export interface ArtifactReadToolAdapterOptions {
  readonly toolId: string;
  readonly read: (artifactId: ArtifactId, maxBytes?: number) => ArtifactReadToolResolution;
}

export class ScopedArtifactReadToolAdapter implements ToolAdapter<
  ArtifactReadToolInput,
  ArtifactReadToolOutput
> {
  readonly toolId: string;

  constructor(private readonly options: ArtifactReadToolAdapterOptions) {
    if (options.toolId.trim() === "") {
      throw new RangeError("toolId must not be empty.");
    }

    this.toolId = options.toolId;
  }

  async invoke(
    request: ToolInvocationRequest<ArtifactReadToolInput>,
  ): Promise<{ output: ArtifactReadToolOutput }> {
    const input = request.input;

    if (
      input === null ||
      typeof input !== "object" ||
      typeof input.artifactId !== "string" ||
      input.artifactId.trim() === ""
    ) {
      throw new ArtifactReadToolError(
        "INVALID_INPUT",
        "Artifact read requires a non-empty artifactId.",
      );
    }

    if (
      input.maxBytes !== undefined &&
      (!Number.isInteger(input.maxBytes) || input.maxBytes <= 0)
    ) {
      throw new ArtifactReadToolError("INVALID_INPUT", "maxBytes must be a positive integer.");
    }

    try {
      const result = this.options.read(input.artifactId, input.maxBytes);

      return {
        output: {
          artifact: result.artifact,
          content: result.content,
          sizeBytes: result.sizeBytes,
          sha256: result.sha256,
        },
      };
    } catch (error) {
      if (error instanceof ArtifactReadToolError) {
        throw error;
      }

      throw new ArtifactReadToolError(
        error instanceof Error && /not found/i.test(error.message)
          ? "ARTIFACT_NOT_FOUND"
          : "CONTENT_READ_FAILED",
        error instanceof Error ? error.message : String(error),
      );
    }
  }
}
