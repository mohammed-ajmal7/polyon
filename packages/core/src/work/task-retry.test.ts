import type { Task } from "@polyon/contracts";
import { describe, expect, it } from "vitest";

import { retryTask, TaskRetryError } from "./task-retry";

const failedTask: Task = {
  id: "task-1",
  missionId: "mission-1",
  kind: "CODING",
  title: "Build runtime",
  description: "Implement runtime.",
  status: "FAILED",
  dependsOn: [],
  createdAt: "2026-09-27T01:00:00.000Z",
  updatedAt: "2026-09-27T01:05:00.000Z",
};

describe("retryTask", () => {
  it("moves a failed task back to READY", () => {
    expect(retryTask(failedTask, [], "2026-09-27T01:10:00.000Z")).toEqual({
      ...failedTask,
      status: "READY",
      updatedAt: "2026-09-27T01:10:00.000Z",
    });
  });

  it("requires all dependencies to have succeeded", () => {
    const task = {
      ...failedTask,
      dependsOn: ["dependency-1"],
    };

    expect(() =>
      retryTask(task, [{ id: "dependency-1", status: "FAILED" }], "2026-09-27T01:10:00.000Z"),
    ).toThrowError(
      new TaskRetryError(
        "TASK_DEPENDENCIES_NOT_SATISFIED",
        "Cannot retry task because its dependencies are not satisfied.",
      ),
    );
  });

  it("rejects tasks that are not failed", () => {
    expect(() =>
      retryTask(
        {
          ...failedTask,
          status: "SUCCEEDED",
        },
        [],
        "2026-09-27T01:10:00.000Z",
      ),
    ).toThrowError(
      new TaskRetryError("TASK_NOT_FAILED", "Cannot retry task with status: SUCCEEDED."),
    );
  });

  it("does not mutate the failed task", () => {
    const before = structuredClone(failedTask);

    retryTask(failedTask, [], "2026-09-27T01:10:00.000Z");

    expect(failedTask).toEqual(before);
  });

  it("allows a retry when all dependencies succeeded", () => {
    const task = {
      ...failedTask,
      dependsOn: ["dependency-1"],
    };

    expect(
      retryTask(task, [{ id: "dependency-1", status: "SUCCEEDED" }], "2026-09-27T01:10:00.000Z")
        .status,
    ).toBe("READY");
  });
});
