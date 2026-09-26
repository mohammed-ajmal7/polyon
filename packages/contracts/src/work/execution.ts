import type { ExecutionId, MissionId, TaskId } from "./ids";

export type ExecutionStatus =
  | "PENDING"
  | "APPROVAL_REQUIRED"
  | "APPROVED"
  | "QUEUED"
  | "RUNNING"
  | "PAUSED"
  | "SUCCEEDED"
  | "FAILED"
  | "CANCELLED"
  | "REJECTED";

export interface Execution {
  readonly id: ExecutionId;
  readonly missionId: MissionId;
  readonly taskId: TaskId;
  readonly attempt: number;
  readonly status: ExecutionStatus;
  readonly startedAt?: string;
  readonly completedAt?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly error?: string;
}
