import type { ApprovalStatus } from "@polyon/contracts";

const transitions: Readonly<Record<ApprovalStatus, readonly ApprovalStatus[]>> = {
  PENDING: ["APPROVED", "REJECTED", "EXPIRED", "CANCELLED"],
  APPROVED: [],
  REJECTED: [],
  EXPIRED: [],
  CANCELLED: [],
};

export function canTransitionApproval(from: ApprovalStatus, to: ApprovalStatus): boolean {
  return transitions[from].includes(to);
}
