import type {
  Artifact,
  ArtifactKind,
  ArtifactStatus,
  ExecutionId,
  MissionId,
  TaskId,
} from "@polyon/contracts";
import type { ToolAdapter, ToolInvocationRequest } from "./tool-adapter";

export interface ArtifactListToolInput {
  readonly missionId?: MissionId;
  readonly taskId?: TaskId;
  readonly executionId?: ExecutionId;
  readonly status?: ArtifactStatus;
  readonly kind?: ArtifactKind;
}

export interface ArtifactListToolOutput {
  readonly artifacts: readonly Artifact[];
}

export interface ArtifactListToolAdapterOptions {
  readonly toolId: string;
  readonly list: (
    filter: ArtifactListToolInput,
  ) => readonly Artifact[];
}

export class ScopedArtifactListToolAdapter implements ToolAdapter<
  ArtifactListToolInput,
  ArtifactListToolOutput
> {
  readonly toolId: string;

  constructor(
    private readonly options: ArtifactListToolAdapterOptions,
  ) {
    if (options.toolId.trim() === "") {
      throw new RangeError("toolId must not be empty.");
    }
  }

  async invoke(
    request: ToolInvocationRequest<ArtifactListToolInput>,
  ): Promise<{ output: ArtifactListToolOutput }> {
    const input = request.input;

    if (input === null || typeof input !== "object") {
      throw new TypeError("Artifact list input must be an object.");
    }

    return {
      output: {
        artifacts: this.options.list(input),
      },
    };
  }
}
