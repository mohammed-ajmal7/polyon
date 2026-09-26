import type { Task } from "@polyon/contracts";
import { describe, expect, it } from "vitest";

import { createExecutionForTask, ExecutionCreationError } from "./execution-creation";
import type { TaskDependency } from "./task-readiness";

const readyTask: Task = {
  id: "task-1",
  missionId: "mission-1",
  kind: "CODING",
  title: "Build execution engine",
  description: "Create the first execution boundary.",
  status: "READY",
  dependsOn: ["task-0"],
  createdAt: "2026-09-27T00:00:00.000Z",
  updatedAt: "2026-09-27T01:00:00.000Z",
};

const succeededDependency: TaskDependency = {
  id: "task-0",
  status: "SUCCEEDED",
};

const input = {
  id: "execution-1",
  actorId: "agent-1",
  attempt: 1,
  createdAt: "2026-09-27T02:00:00.000Z",
} as const;

describe("createExecutionForTask", () => {
  it("creates a pending execution for a ready task", () => {
    const execution = createExecutionForTask(readyTask, [succeededDependency], input);

    expect(execution).toEqual({
      id: "execution-1",
      missionId: "mission-1",
      taskId: "task-1",
      actorId: "agent-1",
      attempt: 1,
      status: "PENDING",
      createdAt: "2026-09-27T02:00:00.000Z",
      updatedAt: "2026-09-27T02:00:00.000Z",
    });
  });

  it("does not mutate the task", () => {
    createExecutionForTask(readyTask, [succeededDependency], input);

    expect(readyTask.status).toBe("READY");
    expect(readyTask.updatedAt).toBe("2026-09-27T01:00:00.000Z");
  });

  it.each([
    "PENDING",
    "BLOCKED",
    "APPROVAL_REQUIRED",
    "APPROVED",
    "RUNNING",
    "PAUSED",
    "SUCCEEDED",
    "FAILED",
    "CANCELLED",
    "REJECTED",
  ] as const)("rejects task with status %s", (status) => {
    const task: Task = {
      ...readyTask,
      status,
    };

    expect(() => createExecutionForTask(task, [succeededDependency], input)).toThrowError(
      expect.objectContaining({
        kind: "TASK_NOT_READY",
      }),
    );
  });

  it("rejects a ready task when a dependency has not succeeded", () => {
    const runningDependency: TaskDependency = {
      id: "task-0",
      status: "RUNNING",
    };

    expect(() => createExecutionForTask(readyTask, [runningDependency], input)).toThrowError(
      expect.objectContaining({
        kind: "TASK_DEPENDENCIES_NOT_SATISFIED",
      }),
    );
  });

  it("rejects a ready task when a dependency failed", () => {
    const failedDependency: TaskDependency = {
      id: "task-0",
      status: "FAILED",
    };

    expect(() => createExecutionForTask(readyTask, [failedDependency], input)).toThrowError(
      expect.objectContaining({
        kind: "TASK_DEPENDENCIES_NOT_SATISFIED",
      }),
    );
  });

  it("rejects when a required dependency is missing", () => {
    expect(() => createExecutionForTask(readyTask, [], input)).toThrowError(
      expect.objectContaining({
        kind: "TASK_DEPENDENCIES_NOT_SATISFIED",
      }),
    );
  });

  it("creates an execution for a ready task with no dependencies", () => {
    const independentTask: Task = {
      ...readyTask,
      dependsOn: [],
    };

    const execution = createExecutionForTask(independentTask, [], input);

    expect(execution.status).toBe("PENDING");
    expect(execution.taskId).toBe("task-1");
  });

  it("preserves the requested retry attempt", () => {
    const execution = createExecutionForTask(readyTask, [succeededDependency], {
      ...input,
      attempt: 3,
    });

    expect(execution.attempt).toBe(3);
  });
});
