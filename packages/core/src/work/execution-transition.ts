import type { Execution } from "@polyon/contracts";

import { canTransitionExecution } from "./execution-lifecycle";
import { InvalidStateTransitionError } from "./transition-error";

export function transitionExecutionStatus(
  execution: Execution,
  to: Execution["status"],
  now: string,
): Execution {
  if (!canTransitionExecution(execution.status, to)) {
    throw new InvalidStateTransitionError("execution", execution.status, to);
  }

  return {
    ...execution,
    status: to,
    updatedAt: now,
  };
}
