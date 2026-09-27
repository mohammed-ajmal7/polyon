import type {
  Artifact,
  ArtifactId,
  ExecutionId,
  MissionId,
  TaskId,
} from "@polyon/contracts";
import type { ArtifactStore } from "@polyon/storage";

export interface ArtifactCatalogFilter {
  readonly missionId?: MissionId;
  readonly taskId?: TaskId;
  readonly executionId?: ExecutionId;
  readonly status?: Artifact["status"];
  readonly kind?: Artifact["kind"];
}

export type ArtifactCatalogServiceErrorKind = "ARTIFACT_NOT_FOUND";

export class ArtifactCatalogServiceError extends Error {
  readonly kind: ArtifactCatalogServiceErrorKind;

  constructor(kind: ArtifactCatalogServiceErrorKind, message: string) {
    super(message);
    this.name = "ArtifactCatalogServiceError";
    this.kind = kind;
  }
}

export interface ArtifactCatalogServiceDependencies {
  readonly artifacts: ArtifactStore;
}

export class ArtifactCatalogService {
  constructor(
    private readonly dependencies: ArtifactCatalogServiceDependencies,
  ) {}

  get(id: ArtifactId): Artifact {
    const artifact = this.dependencies.artifacts.get(id);

    if (artifact === undefined) {
      throw new ArtifactCatalogServiceError(
        "ARTIFACT_NOT_FOUND",
        `Artifact not found: ${id}.`,
      );
    }

    return artifact;
  }

  find(id: ArtifactId): Artifact | undefined {
    return this.dependencies.artifacts.get(id);
  }

  list(filter: ArtifactCatalogFilter = {}): readonly Artifact[] {
    return this.dependencies.artifacts
      .list()
      .filter((artifact) =>
        filter.missionId === undefined
          ? true
          : artifact.missionId === filter.missionId,
      )
      .filter((artifact) =>
        filter.taskId === undefined ? true : artifact.taskId === filter.taskId,
      )
      .filter((artifact) =>
        filter.executionId === undefined
          ? true
          : artifact.executionId === filter.executionId,
      )
      .filter((artifact) =>
        filter.status === undefined ? true : artifact.status === filter.status,
      )
      .filter((artifact) =>
        filter.kind === undefined ? true : artifact.kind === filter.kind,
      )
      .sort((left, right) => {
        const createdAt = left.createdAt.localeCompare(right.createdAt);

        return createdAt === 0
          ? left.id.localeCompare(right.id)
          : createdAt;
      });
  }
}
