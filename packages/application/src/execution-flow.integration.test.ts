import type { Mission, Policy, Task } from "@polyon/contracts";
import {
  ExecutionApprovalService,
  ExecutionDispatchService,
  MissionExecutionService,
} from "@polyon/application";
import { InMemoryExecutionCoordinator, InMemoryExecutionQueue } from "@polyon/runtime";
import { InMemoryDomainStores, InMemoryEventStore } from "@polyon/storage";
import { describe, expect, it } from "vitest";

const mission: Mission = {
  id: "mission-1",
  objective: "Run one governed task.",
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
  title: "Build runtime",
  description: "Implement runtime.",
  status: "PENDING",
  dependsOn: [],
  createdAt: "2026-09-27T01:00:00.000Z",
  updatedAt: "2026-09-27T01:00:00.000Z",
};

const policy: Policy = {
  id: "policy-1",
  name: "Approval required",
  description: "Requires explicit approval for execution.",
  approvalMode: "BALANCED",
  rules: [],
  defaultEffect: "REQUIRE_APPROVAL",
  enabled: true,
  createdAt: "2026-09-27T00:00:00.000Z",
  updatedAt: "2026-09-27T00:00:00.000Z",
};

const identities = {
  executionId: (taskId: string, attempt: number) => "execution-" + taskId + "-" + attempt,
  policyDecisionId: (taskId: string, executionId: string) =>
    "decision-" + taskId + "-" + executionId,
  approvalRequestId: (taskId: string, executionId: string) =>
    "approval-" + taskId + "-" + executionId,
};

describe("governed execution flow", () => {
  it("dispatches, awaits approval, queues, executes, and persists success", async () => {
    const stores = new InMemoryDomainStores();
    const queue = new InMemoryExecutionQueue();
    const events = new InMemoryEventStore();

    const dispatch = new ExecutionDispatchService({
      queue,
      executions: stores.executions,
      approvals: stores.approvals,
      policyDecisions: stores.policyDecisions,
      events,
    });

    const missionService = new MissionExecutionService(
      dispatch,
      (current) => stores.tasks.save(current),
      (taskId) => stores.tasks.get(taskId),
      () => stores.executions.list(),
      events,
    );

    const dispatched = missionService.dispatchReadyTasks({
      mission,
      tasks: [task],
      actorId: "agent-1",
      agentId: "agent-1",
      policy,
      requestedBy: "user-1",
      now: "2026-09-27T01:02:00.000Z",
      riskLevel: "HIGH",
      identities,
    });

    expect(dispatched.awaitingApproval).toHaveLength(1);
    expect(dispatched.awaitingApproval[0]?.execution.status).toBe("APPROVAL_REQUIRED");
    expect(stores.tasks.get("task-1")?.status).toBe("APPROVAL_REQUIRED");
    expect(queue.size()).toBe(0);

    const approvalService = new ExecutionApprovalService({
      approvals: stores.approvals,
      executions: stores.executions,
      tasks: stores.tasks,
      queue,
      events,
    });

    const approval = stores.approvals.get("approval-task-1-execution-task-1-1");
    const execution = stores.executions.get("execution-task-1-1");

    expect(approval).toBeDefined();
    expect(execution).toBeDefined();

    const approvalResult = approvalService.resolve(approval!, execution!, {
      status: "APPROVED",
      resolvedAt: "2026-09-27T01:03:00.000Z",
      resolvedBy: "user-1",
    });

    expect(approvalResult.execution.status).toBe("QUEUED");
    expect(stores.tasks.get("task-1")?.status).toBe("APPROVED");
    expect(queue.peek()?.id).toBe("execution-task-1-1");

    const coordinator = new InMemoryExecutionCoordinator({
      queue,
      runner: {
        async run(current) {
          expect(current.status).toBe("RUNNING");
          expect(current.agentId).toBe("agent-1");
          return { status: "SUCCEEDED" };
        },
      },
      executions: stores.executions,
      tasks: stores.tasks,
      events,
    });

    const completed = await coordinator.runNext(
      "2026-09-27T01:04:00.000Z",
      "2026-09-27T01:05:00.000Z",
    );

    expect(completed?.status).toBe("SUCCEEDED");
    expect(stores.executions.get("execution-task-1-1")?.status).toBe("SUCCEEDED");
    expect(stores.tasks.get("task-1")?.status).toBe("SUCCEEDED");
    expect(queue.size()).toBe(0);

    expect(events.list()).toHaveLength(13);
    expect(events.listByExecution("execution-task-1-1").map((event) => event.kind)).toEqual([
      "EXECUTION_CREATED",
      "POLICY_DECIDED",
      "APPROVAL_REQUESTED",
      "EXECUTION_STATUS_CHANGED",
      "APPROVAL_RESOLVED",
      "EXECUTION_STATUS_CHANGED",
      "EXECUTION_STATUS_CHANGED",
      "EXECUTION_STATUS_CHANGED",
      "EXECUTION_STATUS_CHANGED",
    ]);
    expect(
      events
        .listByTask("task-1")
        .filter((event) => event.kind === "TASK_STATUS_CHANGED")
        .map((event) => event.kind),
    ).toEqual([
      "TASK_STATUS_CHANGED",
      "TASK_STATUS_CHANGED",
      "TASK_STATUS_CHANGED",
      "TASK_STATUS_CHANGED",
    ]);
  });
});
