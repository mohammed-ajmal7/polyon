import type { JobId } from "./ids";

export type JobKind =
  | "research"
  | "ingestion"
  | "embedding"
  | "agent_execution"
  | "debate"
  | "fact_check"
  | "notification"
  | "scheduled";

export type JobStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export interface Job {
  readonly id: JobId;
  readonly userId: string;
  readonly kind: JobKind;
  readonly status: JobStatus;
  readonly payload: unknown;
  readonly result?: unknown;
  readonly attempt: number;
  readonly maxAttempts: number;
  readonly runAt: string;
  readonly startedAt?: string;
  readonly completedAt?: string;
  readonly error?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}
