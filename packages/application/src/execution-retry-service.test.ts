import type { Mission, Policy, Task } from "@polyon/contracts";
import { InMemoryExecutionQueue } from "@polyon/runtime";
import { InMemoryDomainStores, InMemoryEventStore } from "@polyon/storage";
import { describe, expect, it } from "vitest";

import { ExecutionDispatchService } from "./execution-dispatch-service";
import { ExecutionRetryService } from "./execution-retry-service";
import { MissionExecutionService } from "./mission-execution-service";

const mission: Mission = {
  id: "mission-1",
  objective: "Retry mission",
  constraints: [],
  status: "RUNNING",
  taskIds: ["task-1"],
  createdAt: "2026-09-27T01:00:00.000Z",
  updatedAt: "2026-09-27T01:00:00.000Z",
};

const task: Task = {
  id: "task-1",
  missionId: "mission-1",
  kind: "CODING",
  title: "Retry task",
  description: "Retry failed work.",
  status: "FAILED",
  dependsOn: [],
  createdAt: "2026-09-27T01:00:00.000Z",
  updatedAt: "2026-09-27T01:05:00.000Z",
};

const policy: Policy = {
  id: "policy-1",
  name: "Retry policy",
  description: "Allows retry.",
  approvalMode: "BALANCED",
  rules: [],
  defaultEffect: "ALLOW",
  enabled: true,
  createdAt: "2026-09-27T01:00:00.000Z",
  updatedAt: "2026-09-27T01:00:00.000Z",
};

const identities = {
  executionId: (taskId: string, attempt: number) => `execution-${taskId}-${attempt}`,
  policyDecisionId: (taskId: string, executionId: string) => `decision-${taskId}-${executionId}`,
  approvalRequestId: (taskId: string, executionId: string) => `approval-${taskId}-${executionId}`,
};

function createService() {
  const stores = new InMemoryDomainStores();
  const queue = new InMemoryExecutionQueue();
  const events = new InMemoryEventStore();

  stores.tasks.save(task);
  stores.executions.save({
    id: "execution-task-1-1",
    missionId: "mission-1",
    taskId: "task-1",
    actorId: "agent-1",
    attempt: 1,
    status: "FAILED",
    createdAt: "2026-09-27T01:01:00.000Z",
    updatedAt: "2026-09-27T01:05:00.000Z",
    error: "Transient failure.",
  });

  const dispatch = new ExecutionDispatchService({
    queue,
    executions: stores.executions,
    approvals: stores.approvals,
    policyDecisions: stores.policyDecisions,
    events,
  });

  const executionService = new MissionExecutionService(
    dispatch,
    (current) => stores.tasks.save(current),
    (taskId) => stores.tasks.get(taskId),
    () => stores.executions.list(),
    events,
  );

  return {
    stores,
    queue,
    events,
    service: new ExecutionRetryService(
      stores.executions,
      stores.tasks,
      events,
      executionService,
    ),
  };
}

describe("ExecutionRetryService", () => {
  it("creates the next governed execution attempt", () => {
    const { stores, queue, service } = createService();

    const result = service.retryFailedTask({
      mission,
      taskId: "task-1",
      actorId: "agent-1",
      agentId: "agent-1",
      policy,
      requestedBy: "user-1",
      now: "2026-09-27T01:06:00.000Z",
      riskLevel: "LOW",
      identities,
    });

    expect(result.dispatched).toHaveLength(1);
    expect(result.dispatched[0]?.execution.attempt).toBe(2);
    expect(result.dispatched[0]?.execution.id).toBe("execution-task-1-2");
    expect(stores.tasks.get("task-1")?.status).toBe("APPROVED");
    expect(queue.peek()?.id).toBe("execution-task-1-2");
  });

  it("keeps retry approval-governed", () => {
    const { stores, queue, service } = createService();

    const result = service.retryFailedTask({
      mission,
      taskId: "task-1",
      actorId: "agent-1",
      policy: { ...policy, defaultEffect: "REQUIRE_APPROVAL" },
      requestedBy: "user-1",
      now: "2026-09-27T01:06:00.000Z",
      riskLevel: "MEDIUM",
      identities,
    });

    expect(result.awaitingApproval).toHaveLength(1);
    expect(stores.tasks.get("task-1")?.status).toBe("APPROVAL_REQUIRED");
    expect(stores.approvals.list()).toHaveLength(1);
    expect(queue.size()).toBe(0);
  });

  it("rejects retrying a non-failed task", () => {
    const { stores, service } = createService();
    stores.tasks.save({ ...task, status: "SUCCEEDED" });

    expect(() =>
      service.retryFailedTask({
        mission,
        taskId: "task-1",
        actorId: "agent-1",
        policy,
        requestedBy: "user-1",
        now: "2026-09-27T01:06:00.000Z",
        riskLevel: "LOW",
        identities,
      }),
    ).toThrow("Cannot retry task with status: SUCCEEDED.");
  });
});
