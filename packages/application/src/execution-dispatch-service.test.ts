import type { ApprovalRequest, Execution } from "@polyon/contracts";
import { describe, expect, it } from "vitest";

import { ExecutionDispatchService } from "./execution-dispatch-service";
import { InMemoryExecutionQueue } from "@polyon/runtime";
import { InMemoryDomainStores, InMemoryEventStore } from "@polyon/storage";

const task = {
  id: "task-1",
  missionId: "mission-1",
  kind: "CODING" as const,
  title: "Build runtime",
  description: "Implement runtime.",
  status: "READY" as const,
  dependsOn: [],
  createdAt: "2026-09-27T01:00:00.000Z",
  updatedAt: "2026-09-27T01:00:00.000Z",
};

const basePolicy = {
  id: "policy-1",
  name: "Execution policy",
  description: "Controls execution runs.",
  approvalMode: "BALANCED" as const,
  rules: [],
  defaultEffect: "ALLOW" as const,
  enabled: true,
  createdAt: "2026-09-27T00:00:00.000Z",
  updatedAt: "2026-09-27T00:00:00.000Z",
};

function createService() {
  const stores = new InMemoryDomainStores();

  return {
    stores,
    queue: new InMemoryExecutionQueue(),
    service: new ExecutionDispatchService({
      queue: new InMemoryExecutionQueue(),
      executions: stores.executions,
      approvals: stores.approvals,
      policyDecisions: stores.policyDecisions,
      events: new InMemoryEventStore(),
    }),
  };
}

const input = {
  task,
  dependencies: [],
  actorId: "agent-1",
  executionId: "execution-1",
  attempt: 1,
  policy: basePolicy,
  decisionId: "decision-1",
  approvalRequestId: "approval-1",
  requestedBy: "user-1",
  requestedAt: "2026-09-27T01:01:00.000Z",
  evaluatedAt: "2026-09-27T01:02:00.000Z",
  riskLevel: "MEDIUM" as const,
};

describe("ExecutionDispatchService", () => {
  it("persists and enqueues an allowed execution", () => {
    const stores = new InMemoryDomainStores();
    const queue = new InMemoryExecutionQueue();
    const service = new ExecutionDispatchService({
      queue,
      executions: stores.executions,
      approvals: stores.approvals,
      policyDecisions: stores.policyDecisions,
      events: new InMemoryEventStore(),
    });

    expect(service.dispatch(input)).toMatchObject({
      execution: { status: "QUEUED" },
      policyDecision: { effect: "ALLOW" },
      nextStep: "ENQUEUE",
    });

    expect(stores.executions.get("execution-1")?.status).toBe("QUEUED");
    expect(stores.policyDecisions.get("decision-1")?.effect).toBe("ALLOW");
    expect(queue.peek()?.id).toBe("execution-1");
  });

  it("records dispatch trace events for an allowed execution", () => {
    const stores = new InMemoryDomainStores();
    const queue = new InMemoryExecutionQueue();
    const events = new InMemoryEventStore();
    const service = new ExecutionDispatchService({
      queue,
      executions: stores.executions,
      approvals: stores.approvals,
      policyDecisions: stores.policyDecisions,
      events,
    });

    service.dispatch(input);

    expect(events.list().map((event) => event.kind)).toEqual([
      "EXECUTION_CREATED",
      "POLICY_DECIDED",
      "EXECUTION_STATUS_CHANGED",
    ]);
    expect(events.listByExecution("execution-1")[2]?.data).toEqual({
      from: "PENDING",
      to: "QUEUED",
    });
  });
  });

  it("persists an approval-required execution without enqueueing it", () => {
    const stores = new InMemoryDomainStores();
    const queue = new InMemoryExecutionQueue();
    const service = new ExecutionDispatchService({
      queue,
      executions: stores.executions,
      approvals: stores.approvals,
      policyDecisions: stores.policyDecisions,
      events: new InMemoryEventStore(),
    });

    const result = service.dispatch({
      ...input,
      policy: {
        ...basePolicy,
        defaultEffect: "REQUIRE_APPROVAL" as const,
      },
    });

    expect(result.execution.status).toBe("APPROVAL_REQUIRED");
    expect(result.nextStep).toBe("AWAIT_APPROVAL");
    expect(stores.approvals.get("approval-1")?.status).toBe("PENDING");
    expect(queue.size()).toBe(0);
  });

  it("persists policy denial as a rejected execution", () => {
    const stores = new InMemoryDomainStores();
    const queue = new InMemoryExecutionQueue();
    const service = new ExecutionDispatchService({
      queue,
      executions: stores.executions,
      approvals: stores.approvals,
      policyDecisions: stores.policyDecisions,
      events: new InMemoryEventStore(),
    });

    const result = service.dispatch({
      ...input,
      policy: {
        ...basePolicy,
        defaultEffect: "DENY" as const,
      },
    });

    expect(result.execution.status).toBe("REJECTED");
    expect(result.nextStep).toBe("REJECTED");
    expect(queue.size()).toBe(0);
  });

  it("rejects duplicate execution identifiers", () => {
    const stores = new InMemoryDomainStores();
    stores.executions.save({
      id: "execution-1",
      missionId: "mission-1",
      taskId: "task-1",
      actorId: "agent-1",
      attempt: 1,
      status: "PENDING",
      createdAt: "2026-09-27T01:00:00.000Z",
      updatedAt: "2026-09-27T01:00:00.000Z",
    });
    const service = new ExecutionDispatchService({
      queue: new InMemoryExecutionQueue(),
      executions: stores.executions,
      approvals: stores.approvals,
      policyDecisions: stores.policyDecisions,
      events: new InMemoryEventStore(),
    });

    expect(() => service.dispatch(input)).toThrow("Execution already exists: execution-1.");
  });

  it("moves an approved execution to the queue", () => {
    const stores = new InMemoryDomainStores();
    const queue = new InMemoryExecutionQueue();
    const service = new ExecutionDispatchService({
      queue,
      executions: stores.executions,
      approvals: stores.approvals,
      policyDecisions: stores.policyDecisions,
      events: new InMemoryEventStore(),
    });

    const approval: ApprovalRequest = {
      id: "approval-1",
      policyId: "policy-1",
      policyDecisionId: "decision-1",
      missionId: "mission-1",
      taskId: "task-1",
      executionId: "execution-1",
      action: "EXECUTION_RUN",
      riskLevel: "MEDIUM",
      requestedBy: "user-1",
      reason: "Needs approval.",
      status: "APPROVED",
      requestedAt: "2026-09-27T01:01:00.000Z",
    };
    const execution: Execution = {
      id: "execution-1",
      missionId: "mission-1",
      taskId: "task-1",
      actorId: "agent-1",
      attempt: 1,
      status: "APPROVAL_REQUIRED",
      createdAt: "2026-09-27T01:00:00.000Z",
      updatedAt: "2026-09-27T01:01:00.000Z",
    };

    expect(service.queueApproved(approval, execution, "2026-09-27T01:02:00.000Z")).toMatchObject({
      status: "QUEUED",
      updatedAt: "2026-09-27T01:02:00.000Z",
    });
    expect(queue.peek()?.id).toBe("execution-1");
  });

  it("does not enqueue a rejected execution", () => {
    const stores = new InMemoryDomainStores();
    const queue = new InMemoryExecutionQueue();
    const service = new ExecutionDispatchService({
      queue,
      executions: stores.executions,
      approvals: stores.approvals,
      policyDecisions: stores.policyDecisions,
    });

    const rejected = service.dispatch({
      ...input,
      policy: {
        ...basePolicy,
        defaultEffect: "DENY" as const,
      },
    });

    expect(rejected.execution.status).toBe("REJECTED");
    expect(queue.size()).toBe(0);
  });
});
