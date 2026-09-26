import type { Task } from "@polyon/contracts";
import { describe, expect, it } from "vitest";

import { getReadyTaskIds } from "./task-ready";

function createTask(
  id: string,
  status: Task["status"] = "PENDING",
  dependsOn: readonly string[] = [],
): Task {
  return {
    id,
    missionId: "mission-1",
    kind: "CODING",
    title: id,
    description: `Task ${id}`,
    status,
    dependsOn,
    createdAt: "2026-09-27T00:00:00.000Z",
    updatedAt: "2026-09-27T00:00:00.000Z",
  };
}

describe("getReadyTaskIds", () => {
  it("returns pending tasks with no dependencies", () => {
    expect(getReadyTaskIds([createTask("task-1"), createTask("task-2")])).toEqual([
      "task-1",
      "task-2",
    ]);
  });

  it("returns a task when all dependencies succeeded", () => {
    expect(
      getReadyTaskIds([
        createTask("task-1", "SUCCEEDED"),
        createTask("task-2", "PENDING", ["task-1"]),
      ]),
    ).toEqual(["task-2"]);
  });

  it("does not return a task when a dependency is still running", () => {
    expect(
      getReadyTaskIds([
        createTask("task-1", "RUNNING"),
        createTask("task-2", "PENDING", ["task-1"]),
      ]),
    ).toEqual([]);
  });

  it("does not return a task when a dependency failed", () => {
    expect(
      getReadyTaskIds([
        createTask("task-1", "FAILED"),
        createTask("task-2", "PENDING", ["task-1"]),
      ]),
    ).toEqual([]);
  });

  it("returns a blocked task when its dependencies are satisfied", () => {
    expect(
      getReadyTaskIds([
        createTask("task-1", "SUCCEEDED"),
        createTask("task-2", "BLOCKED", ["task-1"]),
      ]),
    ).toEqual(["task-2"]);
  });

  it("does not return tasks already in execution or terminal states", () => {
    expect(
      getReadyTaskIds([
        createTask("task-1", "READY"),
        createTask("task-2", "RUNNING"),
        createTask("task-3", "PAUSED"),
        createTask("task-4", "APPROVAL_REQUIRED"),
        createTask("task-5", "APPROVED"),
        createTask("task-6", "SUCCEEDED"),
        createTask("task-7", "FAILED"),
        createTask("task-8", "CANCELLED"),
        createTask("task-9", "REJECTED"),
      ]),
    ).toEqual([]);
  });

  it("returns independent ready tasks together", () => {
    expect(
      getReadyTaskIds([
        createTask("task-1", "SUCCEEDED"),
        createTask("task-2", "SUCCEEDED"),
        createTask("task-3", "PENDING", ["task-1"]),
        createTask("task-4", "PENDING", ["task-2"]),
        createTask("task-5", "PENDING", ["task-1", "task-2"]),
      ]),
    ).toEqual(["task-3", "task-4", "task-5"]);
  });
});
