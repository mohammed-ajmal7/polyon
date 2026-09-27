import type { ApprovalRequest, Execution, Task } from "@polyon/contracts";
import { describe, expect, it } from "vitest";

import { InMemoryExecutionQueue } from "@polyon/runtime";
import { InMemoryDomainStores, InMemoryEventStore } from "@polyon/storage";

import {
  ExecutionApprovalService,
  ExecutionApprovalServiceError,
  type ResolveExecutionApprovalInput,
} from "./execution-approval-service";

const execution: Execution = {
  id: "execution-1",
  missionId: "mission-1",
  taskId: "task-1",
  actorId: "agent-1",
  attempt: 1,
  status: "APPROVAL_REQUIRED",
  createdAt: "2026-09-27T01:00:00.000Z",
  updatedAt: "2026-09-27T01:00:00.000Z",
};

const task: Task = {
  id: "task-1",
  missionId: "mission-1",
  kind: "CODING",
  title: "Build runtime",
  description: "Implement runtime.",
  status: "APPROVAL_REQUIRED",
  dependsOn: [],
  createdAt: "2026-09-27T01:00:00.000Z",
  updatedAt: "2026-09-27T01:01:00.000Z",
};

const approval: ApprovalRequest = {
  id: "approval-1",
  policyId: "policy-1",
  policyDecisionId: "decision-1",
  missionId: "mission-1",
  taskId: "task-1",
  executionId: "execution-1",
  action: "EXECUTION_RUN",
  riskLevel: "HIGH",
  requestedBy: "user-1",
  reason: "High-risk execution.",
  status: "PENDING",
  requestedAt: "2026-09-27T01:01:00.000Z",
};

function createService() {
  const stores = new InMemoryDomainStores();
  const queue = new InMemoryExecutionQueue();
  const events = new InMemoryEventStore();
  stores.tasks.save(task);

  const service = new ExecutionApprovalService({
    approvals: stores.approvals,
    executions: stores.executions,
    tasks: stores.tasks,
    queue,
    events,
  });

  return { stores, queue, events, service };
}

describe("ExecutionApprovalService", () => {
  it("rejects resolving an execution that is not awaiting approval", () => {
    const { service } = createService();

    expect(() =>
      service.resolve(
        approval,
        {
          ...execution,
          status: "PENDING",
        },
        {
          status: "REJECTED",
          resolvedAt: "2026-09-27T01:02:00.000Z",
        },
      ),
    ).toThrowError(
      new ExecutionApprovalServiceError(
        "EXECUTION_NOT_AWAITING_APPROVAL",
        "Cannot resolve execution approval while execution status is PENDING.",
      ),
    );
  });

  it("approves and queues an execution", () => {
    const { stores, queue, events, service } = createService();

    const result = service.resolve(approval, execution, {
      status: "APPROVED",
      resolvedAt: "2026-09-27T01:02:00.000Z",
      resolvedBy: "user-1",
    });

    expect(result).toMatchObject({
      approval: {
        status: "APPROVED",
        resolvedAt: "2026-09-27T01:02:00.000Z",
        resolvedBy: "user-1",
      },
      execution: {
        status: "QUEUED",
        updatedAt: "2026-09-27T01:02:00.000Z",
      },
      nextStep: "ENQUEUE",
    });
    expect(stores.approvals.get("approval-1")?.status).toBe("APPROVED");
    expect(stores.executions.get("execution-1")?.status).toBe("QUEUED");
    expect(stores.tasks.get("task-1")?.status).toBe("APPROVED");
    expect(queue.peek()?.id).toBe("execution-1");
    expect(events.list().map((event) => event.kind)).toEqual([
      "APPROVAL_RESOLVED",
      "EXECUTION_STATUS_CHANGED",
      "TASK_STATUS_CHANGED",
      "EXECUTION_STATUS_CHANGED",
    ]);
  });

  it("rejects and persists a rejected execution", () => {
    const { stores, queue, service } = createService();

    const result = service.resolve(approval, execution, {
      status: "REJECTED",
      resolvedAt: "2026-09-27T01:02:00.000Z",
      resolvedBy: "user-1",
      rejectionReason: "User rejected the execution.",
    });

    expect(result.execution).toEqual({
      ...execution,
      status: "REJECTED",
      updatedAt: "2026-09-27T01:02:00.000Z",
      error: "User rejected the execution.",
    });
    expect(stores.approvals.get("approval-1")?.status).toBe("REJECTED");
    expect(stores.tasks.get("task-1")?.status).toBe("REJECTED");
    expect(queue.size()).toBe(0);
  });

  it("expires an execution approval without enqueueing it", () => {
    const { stores, queue, service } = createService();

    const result = service.resolve(approval, execution, {
      status: "EXPIRED",
      resolvedAt: "2026-09-27T01:03:00.000Z",
    });

    expect(result.execution.status).toBe("REJECTED");
    expect(result.nextStep).toBe("REJECTED");
    expect(stores.approvals.get("approval-1")?.status).toBe("EXPIRED");
    expect(stores.tasks.get("task-1")?.status).toBe("REJECTED");
    expect(queue.size()).toBe(0);
  });

  it("cancels an execution approval without enqueueing it", () => {
    const { stores, service } = createService();

    const result = service.resolve(approval, execution, {
      status: "CANCELLED",
      resolvedAt: "2026-09-27T01:03:00.000Z",
    });

    expect(result.execution.status).toBe("CANCELLED");
    expect(stores.approvals.get("approval-1")?.status).toBe("CANCELLED");
    expect(stores.tasks.get("task-1")?.status).toBe("CANCELLED");
  });

  it("rejects a non-execution approval action for every resolution path", () => {
    const { service } = createService();

    expect(() =>
      service.resolve({ ...approval, action: "PLAN_APPLY" }, execution, {
        status: "REJECTED",
        resolvedAt: "2026-09-27T01:02:00.000Z",
      }),
    ).toThrow("Approval does not authorize an execution run.");
  });

  it("rejects an approval bound to another execution before rejection", () => {
    const { service } = createService();

    expect(() =>
      service.resolve({ ...approval, executionId: "execution-2" }, execution, {
        status: "REJECTED",
        resolvedAt: "2026-09-27T01:02:00.000Z",
      }),
    ).toThrow("Approval is not bound to the supplied execution.");
  });

  it("propagates approval binding failures", () => {
    const { service } = createService();

    expect(() =>
      service.resolve(
        {
          ...approval,
          executionId: "execution-2",
        },
        execution,
        {
          status: "APPROVED",
          resolvedAt: "2026-09-27T01:02:00.000Z",
        },
      ),
    ).toThrow();
  });

  it("does not mutate approval or execution input values", () => {
    const { service } = createService();
    const beforeApproval = structuredClone(approval);
    const beforeExecution = structuredClone(execution);
    const input: ResolveExecutionApprovalInput = {
      status: "APPROVED",
      resolvedAt: "2026-09-27T01:02:00.000Z",
    };

    service.resolve(approval, execution, input);

    expect(approval).toEqual(beforeApproval);
    expect(execution).toEqual(beforeExecution);
  });
});
