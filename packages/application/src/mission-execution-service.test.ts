import type { Mission, Policy, Task } from "@polyon/contracts";
import { describe, expect, it } from "vitest";

import { InMemoryExecutionQueue } from "@polyon/runtime";
import { InMemoryDomainStores } from "@polyon/storage";
import { ExecutionDispatchService } from "./execution-dispatch-service";
import {
  MissionExecutionService,
  MissionExecutionValidationError,
} from "./mission-execution-service";

const mission: Mission = {
  id: "mission-1",
  objective: "Build POLYON",
  constraints: [],
  status: "RUNNING",
  taskIds: ["task-1", "task-2", "task-3"],
  createdAt: "2026-09-27T01:00:00.000Z",
  updatedAt: "2026-09-27T01:00:00.000Z",
};

const tasks: Task[] = [
  {
    id: "task-1",
    missionId: "mission-1",
    kind: "CODING",
    title: "Independent A",
    description: "No dependency.",
    status: "PENDING",
    dependsOn: [],
    createdAt: "2026-09-27T01:00:00.000Z",
    updatedAt: "2026-09-27T01:00:00.000Z",
  },
  {
    id: "task-2",
    missionId: "mission-1",
    kind: "RESEARCH",
    title: "Independent B",
    description: "No dependency.",
    status: "PENDING",
    dependsOn: [],
    createdAt: "2026-09-27T01:00:00.000Z",
    updatedAt: "2026-09-27T01:00:00.000Z",
  },
  {
    id: "task-3",
    missionId: "mission-1",
    kind: "VALIDATION",
    title: "Dependent",
    description: "Waits for task 1.",
    status: "BLOCKED",
    dependsOn: ["task-1"],
    createdAt: "2026-09-27T01:00:00.000Z",
    updatedAt: "2026-09-27T01:00:00.000Z",
  },
];

const policy: Policy = {
  id: "policy-1",
  name: "Execution policy",
  description: "Controls execution runs.",
  approvalMode: "BALANCED",
  rules: [],
  defaultEffect: "ALLOW",
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

function createService() {
  const stores = new InMemoryDomainStores();
  const queue = new InMemoryExecutionQueue();
  const dispatch = new ExecutionDispatchService({
    queue,
    executions: stores.executions,
    approvals: stores.approvals,
    policyDecisions: stores.policyDecisions,
  });
  const service = new MissionExecutionService(
    dispatch,
    (task) => stores.tasks.save(task),
    (taskId) => stores.tasks.get(taskId),
    () => stores.executions.list(),
  );

  return { stores, queue, service };
}

describe("MissionExecutionService", () => {
  it("dispatches all currently ready independent tasks", () => {
    const { stores, queue, service } = createService();

    const result = service.dispatchReadyTasks({
      mission,
      tasks,
      actorId: "agent-1",
      policy,
      requestedBy: "user-1",
      now: "2026-09-27T01:02:00.000Z",
      riskLevel: "MEDIUM",
      identities,
    });

    expect(result.dispatched.map((plan) => plan.execution.taskId)).toEqual([
      "task-1",
      "task-2",
    ]);
    expect(result.awaitingApproval).toEqual([]);
    expect(result.rejected).toEqual([]);
    expect(queue.size()).toBe(2);
    expect(stores.tasks.get("task-1")?.status).toBe("RUNNING");
    expect(stores.tasks.get("task-2")?.status).toBe("RUNNING");
  });

  it("does not dispatch a dependent task before its dependency succeeds", () => {
    const { queue, service } = createService();

    const result = service.dispatchReadyTasks({
      mission,
      tasks,
      actorId: "agent-1",
      policy,
      requestedBy: "user-1",
      now: "2026-09-27T01:02:00.000Z",
      riskLevel: "MEDIUM",
      identities,
    });

    expect(result.dispatched.map((plan) => plan.execution.taskId)).not.toContain("task-3");
    expect(queue.size()).toBe(2);
  });

  it("does not redispatch a task whose persisted state is already active", () => {
    const { stores, queue, service } = createService();

    const first = service.dispatchReadyTasks({
      mission,
      tasks,
      actorId: "agent-1",
      policy,
      requestedBy: "user-1",
      now: "2026-09-27T01:02:00.000Z",
      riskLevel: "MEDIUM",
      identities,
    });

    const second = service.dispatchReadyTasks({
      mission,
      tasks,
      actorId: "agent-1",
      policy,
      requestedBy: "user-1",
      now: "2026-09-27T01:03:00.000Z",
      riskLevel: "MEDIUM",
      identities,
    });

    expect(first.dispatched).toHaveLength(2);
    expect(second.dispatched).toEqual([]);
    expect(stores.executions.list()).toHaveLength(2);
    expect(queue.size()).toBe(2);
  });

  it("persists approval-required plans without enqueueing them", () => {
    const { stores, queue, service } = createService();

    const result = service.dispatchReadyTasks({
      mission,
      tasks: [tasks[0]!],
      actorId: "agent-1",
      policy: {
        ...policy,
        defaultEffect: "REQUIRE_APPROVAL",
      },
      requestedBy: "user-1",
      now: "2026-09-27T01:02:00.000Z",
      riskLevel: "MEDIUM",
      identities,
    });

    expect(result.awaitingApproval).toHaveLength(1);
    expect(result.awaitingApproval[0]?.execution.status).toBe("APPROVAL_REQUIRED");
    expect(stores.tasks.get("task-1")?.status).toBe("APPROVAL_REQUIRED");
    expect(stores.approvals.list()).toHaveLength(1);
    expect(queue.size()).toBe(0);
  });

  it("records denied plans as rejected executions", () => {
    const { stores, queue, service } = createService();

    const result = service.dispatchReadyTasks({
      mission,
      tasks: [tasks[0]!],
      actorId: "agent-1",
      policy: {
        ...policy,
        defaultEffect: "DENY",
      },
      requestedBy: "user-1",
      now: "2026-09-27T01:02:00.000Z",
      riskLevel: "HIGH",
      identities,
    });

    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]?.execution.status).toBe("REJECTED");
    expect(stores.executions.get("execution-task-1-1")?.status).toBe("REJECTED");
    expect(stores.tasks.get("task-1")?.status).toBe("REJECTED");
    expect(queue.size()).toBe(0);
  });

  it("increments attempts from persisted execution history", () => {
    const { stores, service } = createService();

    stores.executions.save({
      id: "execution-task-1-1",
      missionId: "mission-1",
      taskId: "task-1",
      actorId: "agent-1",
      attempt: 1,
      status: "FAILED",
      createdAt: "2026-09-27T00:00:00.000Z",
      updatedAt: "2026-09-27T01:00:00.000Z",
      error: "Previous attempt failed.",
    });

    const result = service.dispatchReadyTasks({
      mission,
      tasks: [tasks[0]!],
      actorId: "agent-2",
      policy,
      requestedBy: "user-1",
      now: "2026-09-27T01:02:00.000Z",
      riskLevel: "MEDIUM",
      identities,
    });

    expect(result.dispatched[0]?.execution.attempt).toBe(2);
    expect(result.dispatched[0]?.execution.id).toBe("execution-task-1-2");
  });

  it("rejects an invalid mission task plan", () => {
    const { service } = createService();

    expect(() =>
      service.dispatchReadyTasks({
        mission: {
          ...mission,
          taskIds: ["task-1", "missing"],
        },
        tasks: [tasks[0]!],
        actorId: "agent-1",
        policy,
        requestedBy: "user-1",
        now: "2026-09-27T01:02:00.000Z",
        riskLevel: "MEDIUM",
        identities,
      }),
    ).toThrowError(MissionExecutionValidationError);
  });
});
