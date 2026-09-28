import type { AgentId } from "../agent/ids";
import type { AgentRunId } from "./ids";

export type AgentRunMode = "simple" | "research" | "deep";
export type AgentRunStatus = "queued" | "running" | "completed" | "failed";

export interface AgentRun {
  readonly id: AgentRunId;
  readonly userId: string;
  readonly task: string;
  readonly mode: AgentRunMode;
  readonly status: AgentRunStatus;

  readonly agentIds: readonly AgentId[];
  readonly messageIds: readonly string[];
  readonly evidenceIds: readonly string[];
  readonly executionIds: readonly string[];
  readonly approvalIds: readonly string[];
  readonly toolInvocationIds: readonly string[];
  readonly artifactIds: readonly string[];

  readonly startedAt?: string;
  readonly completedAt?: string;
  readonly finalAnswer?: string;
  readonly error?: string;

  readonly createdAt: string;
  readonly updatedAt: string;
}
