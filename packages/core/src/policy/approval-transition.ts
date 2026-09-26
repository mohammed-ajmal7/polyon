import type { ActorId, ApprovalRequest } from "@polyon/contracts";

import { canTransitionApproval } from "./approval-lifecycle";

export class InvalidApprovalTransitionError extends Error {
  readonly from: ApprovalRequest["status"];
  readonly to: ApprovalRequest["status"];

  constructor(from: ApprovalRequest["status"], to: ApprovalRequest["status"]) {
    super(`Invalid approval transition: ${from} -> ${to}`);
    this.name = "InvalidApprovalTransitionError";
    this.from = from;
    this.to = to;
  }
}

export function transitionApprovalStatus(
  request: ApprovalRequest,
  to: ApprovalRequest["status"],
  resolvedAt: string,
  resolvedBy?: ActorId,
): ApprovalRequest {
  if (!canTransitionApproval(request.status, to)) {
    throw new InvalidApprovalTransitionError(request.status, to);
  }

  return {
    ...request,
    status: to,
    resolvedAt,
    resolvedBy,
  };
}
