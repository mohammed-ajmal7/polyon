import type { AgentRunId } from "./ids";

export type JobId = string;

export type JobStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

export interface Job {
  readonly id: JobId;
  readonly userId?: string;
  readonly agentRunId?: AgentRunId;

  readonly type: string;
  readonly payload: unknown;

  readonly status: JobStatus;
  readonly priority: number;
  readonly attempt: number;
  readonly maxAttempts: number;

  readonly runAt: string;
  readonly lockedBy?: string;
  readonly lockedAt?: string;

  readonly completedAt?: string;
  readonly failedAt?: string;
  readonly error?: string;

  readonly createdAt: string;
  readonly updatedAt: string;
}
