import type {
  ApprovalRequest,
  PolicyDecision,
} from "@polyon/contracts";

import {
  applyApprovedExecutionRun,
  prepareExecutionDispatch,
} from "@polyon/core";
import type { ExecutionDispatchPlan, PrepareExecutionDispatchInput } from "./execution-dispatch";
import type { ExecutionQueue } from "@polyon/runtime";
import type { ApprovalRequestStore, ExecutionStore, PolicyDecisionStore } from "@polyon/storage";

export interface ExecutionDispatchServiceDependencies {
  readonly queue: ExecutionQueue;
  readonly executions: ExecutionStore;
  readonly approvals: ApprovalRequestStore;
  readonly policyDecisions: PolicyDecisionStore;
}

export interface PersistedExecutionDispatch {
  readonly execution: ExecutionDispatchPlan["execution"];
  readonly policyDecision: PolicyDecision;
  readonly approvalRequest?: ApprovalRequest;
  readonly nextStep: ExecutionDispatchPlan["nextStep"];
}

export class ExecutionDispatchService {
  constructor(private readonly dependencies: ExecutionDispatchServiceDependencies) {}

  dispatch(input: PrepareExecutionDispatchInput): PersistedExecutionDispatch {
    if (this.dependencies.executions.get(input.executionId) !== undefined) {
      throw new Error(`Execution already exists: ${input.executionId}.`);
    }

    const plan = prepareExecutionDispatch(input);

    this.dependencies.executions.save(plan.execution);
    this.dependencies.policyDecisions.save(plan.policyDecision);

    if (plan.approvalRequest !== undefined) {
      this.dependencies.approvals.save(plan.approvalRequest);
    }

    if (plan.nextStep === "ENQUEUE") {
      this.dependencies.queue.enqueue(plan.execution);
    }

    return plan;
  }

  queueApproved(
    approval: ApprovalRequest,
    execution: PersistedExecutionDispatch["execution"],
    now: string,
  ): PersistedExecutionDispatch["execution"] {
    const approved = applyApprovedExecutionRun(approval, execution, now);

    const queued = {
      ...approved,
      status: "QUEUED" as const,
      updatedAt: now,
    };

    this.dependencies.approvals.save(approval);
    this.dependencies.executions.save(queued);
    this.dependencies.queue.enqueue(queued);

    return queued;
  }
}
