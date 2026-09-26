import type { MissionId, TaskId } from "./ids";

export type TaskStatus =
  | "PENDING"
  | "BLOCKED"
  | "READY"
  | "APPROVAL_REQUIRED"
  | "APPROVED"
  | "RUNNING"
  | "PAUSED"
  | "SUCCEEDED"
  | "FAILED"
  | "CANCELLED"
  | "REJECTED";

export type TaskKind = "RESEARCH" | "ANALYSIS" | "CODING" | "CREATIVE" | "VALIDATION" | "OTHER";

export interface Task {
  readonly id: TaskId;
  readonly missionId: MissionId;
  readonly kind: TaskKind;
  readonly title: string;
  readonly description: string;
  readonly status: TaskStatus;
  readonly dependsOn: readonly TaskId[];
  readonly createdAt: string;
  readonly updatedAt: string;
}
