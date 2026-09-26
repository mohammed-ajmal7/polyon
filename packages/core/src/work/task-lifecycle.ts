import type { TaskStatus } from "@polyon/contracts";

const transitions: Readonly<Record<TaskStatus, readonly TaskStatus[]>> = {
  PENDING: ["BLOCKED", "READY", "CANCELLED", "REJECTED"],
  BLOCKED: ["READY", "CANCELLED"],
  READY: ["APPROVAL_REQUIRED", "RUNNING", "CANCELLED", "REJECTED"],
  APPROVAL_REQUIRED: ["APPROVED", "REJECTED", "CANCELLED"],
  APPROVED: ["RUNNING", "CANCELLED"],
  RUNNING: ["PAUSED", "SUCCEEDED", "FAILED", "CANCELLED"],
  PAUSED: ["RUNNING", "CANCELLED"],
  SUCCEEDED: [],
  FAILED: [],
  CANCELLED: [],
  REJECTED: [],
};

export function canTransitionTask(from: TaskStatus, to: TaskStatus): boolean {
  return transitions[from].includes(to);
}
