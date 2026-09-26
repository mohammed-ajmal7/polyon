import type { ArtifactId } from "./ids";
import type { ExecutionId, MissionId, TaskId } from "../work/ids";

export type ArtifactKind =
  "DOCUMENT" | "IMAGE" | "VIDEO" | "AUDIO" | "CODE" | "DATASET" | "REPORT" | "OTHER";

export type ArtifactStatus = "CREATING" | "AVAILABLE" | "FAILED" | "DELETED";

export interface Artifact {
  readonly id: ArtifactId;

  readonly kind: ArtifactKind;
  readonly name: string;
  readonly mimeType?: string;

  readonly location: string;

  readonly status: ArtifactStatus;

  readonly missionId?: MissionId;
  readonly taskId?: TaskId;
  readonly executionId?: ExecutionId;

  readonly createdAt: string;
  readonly updatedAt: string;
}
