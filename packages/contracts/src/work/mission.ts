import type { MissionId, TaskId } from "./ids";

export type MissionStatus =
  "DRAFT" | "PLANNING" | "WAITING" | "RUNNING" | "PAUSED" | "SUCCEEDED" | "FAILED" | "CANCELLED";

export interface Mission {
  readonly id: MissionId;
  readonly objective: string;
  readonly constraints: readonly string[];
  readonly status: MissionStatus;
  readonly taskIds: readonly TaskId[];
  readonly createdAt: string;
  readonly updatedAt: string;
}
