import type { ExecutionStatus } from "@polyon/contracts";

const transitions: Readonly<Record<ExecutionStatus, readonly ExecutionStatus[]>> = {
  PENDING: ["APPROVAL_REQUIRED", "QUEUED", "CANCELLED", "REJECTED"],
  APPROVAL_REQUIRED: ["APPROVED", "REJECTED", "CANCELLED"],
  APPROVED: ["QUEUED", "CANCELLED"],
  QUEUED: ["RUNNING", "CANCELLED"],
  RUNNING: ["PAUSED", "SUCCEEDED", "FAILED", "CANCELLED"],
  PAUSED: ["QUEUED", "REJECTED", "CANCELLED"],
  SUCCEEDED: [],
  FAILED: [],
  CANCELLED: [],
  REJECTED: [],
};

export function canTransitionExecution(from: ExecutionStatus, to: ExecutionStatus): boolean {
  return transitions[from].includes(to);
}
