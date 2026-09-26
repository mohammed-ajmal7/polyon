import { describe, expect, it } from "vitest";

import { transitionTaskStatus } from "./task-transition";
import { InvalidStateTransitionError } from "./transition-error";

const task = {
  id: "task-1",
  missionId: "mission-1",
  kind: "CODING" as const,
  title: "Implement feature",
  description: "Implement the requested feature",
  status: "READY" as const,
  dependsOn: [],
  createdAt: "2026-09-27T00:00:00.000Z",
  updatedAt: "2026-09-27T00:00:00.000Z",
};

describe("transitionTaskStatus", () => {
  it("returns a new task with the new status", () => {
    const updated = transitionTaskStatus(task, "RUNNING", "2026-09-27T01:00:00.000Z");

    expect(updated.status).toBe("RUNNING");
    expect(updated.updatedAt).toBe("2026-09-27T01:00:00.000Z");
  });

  it("does not mutate the original task", () => {
    const updated = transitionTaskStatus(task, "RUNNING", "2026-09-27T01:00:00.000Z");

    expect(task.status).toBe("READY");
    expect(updated).not.toBe(task);
  });

  it("rejects an invalid transition", () => {
    expect(() => transitionTaskStatus(task, "SUCCEEDED", "2026-09-27T01:00:00.000Z")).toThrow(
      InvalidStateTransitionError,
    );
  });
});
