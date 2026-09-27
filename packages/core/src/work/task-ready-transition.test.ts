import type { Task } from "@polyon/contracts";
import { describe, expect, it } from "vitest";

import { markTaskReady, TaskReadyError } from "./task-ready-transition";
import type { TaskDependency } from "./task-readiness";

const blockedTask: Task = {
  id: "task-2",
  missionId: "mission-1",
  kind: "CODING",
  title: "Task 2",
  description: "Depends on task 1.",
  status: "BLOCKED",
  dependsOn: ["task-1"],
  createdAt: "2026-09-27T00:00:00.000Z",
  updatedAt: "2026-09-27T01:00:00.000Z",
};

const succeededDependency: TaskDependency = {
  id: "task-1",
  status: "SUCCEEDED",
};

describe("markTaskReady", () => {
  it("marks a blocked task ready when all dependencies succeeded", () => {
    expect(markTaskReady(blockedTask, [succeededDependency], "2026-09-27T01:02:00.000Z")).toEqual({
      ...blockedTask,
      status: "READY",
      updatedAt: "2026-09-27T01:02:00.000Z",
    });
  });

  it("marks an independent pending task ready", () => {
    const task: Task = {
      ...blockedTask,
      status: "PENDING",
      dependsOn: [],
    };

    expect(markTaskReady(task, [], "2026-09-27T01:02:00.000Z").status).toBe("READY");
  });

  it("rejects a task whose dependencies are not satisfied", () => {
    expect(() =>
      markTaskReady(
        blockedTask,
        [{ id: "task-1", status: "RUNNING" }],
        "2026-09-27T01:02:00.000Z",
      ),
    ).toThrowError(
      expect.objectContaining({
        kind: "TASK_DEPENDENCIES_NOT_SATISFIED",
      }),
    );
  });

  it.each([
    "READY",
    "APPROVAL_REQUIRED",
    "APPROVED",
    "RUNNING",
    "PAUSED",
    "SUCCEEDED",
    "FAILED",
    "CANCELLED",
    "REJECTED",
  ] as const)("rejects task status %s", (status) => {
    expect(() =>
      markTaskReady(
        {
          ...blockedTask,
          status,
        },
        [succeededDependency],
        "2026-09-27T01:02:00.000Z",
      ),
    ).toThrowError(TaskReadyError);
  });

  it("does not mutate the original task", () => {
    const before = structuredClone(blockedTask);

    markTaskReady(blockedTask, [succeededDependency], "2026-09-27T01:02:00.000Z");

    expect(blockedTask).toEqual(before);
  });
});
