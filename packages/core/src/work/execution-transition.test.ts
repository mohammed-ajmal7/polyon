import { describe, expect, it } from "vitest";

import { transitionExecutionStatus } from "./execution-transition";
import { InvalidStateTransitionError } from "./transition-error";

const execution = {
  id: "execution-1",
  missionId: "mission-1",
  taskId: "task-1",
  actorId: "agent-1",
  attempt: 1,
  status: "PENDING" as const,
  createdAt: "2026-09-27T00:00:00.000Z",
  updatedAt: "2026-09-27T00:00:00.000Z",
};

describe("transitionExecutionStatus", () => {
  it("returns a new execution with the new status", () => {
    const updated = transitionExecutionStatus(execution, "QUEUED", "2026-09-27T01:00:00.000Z");

    expect(updated.status).toBe("QUEUED");
    expect(updated.updatedAt).toBe("2026-09-27T01:00:00.000Z");
  });

  it("does not mutate the original execution", () => {
    const updated = transitionExecutionStatus(execution, "QUEUED", "2026-09-27T01:00:00.000Z");

    expect(execution.status).toBe("PENDING");
    expect(updated).not.toBe(execution);
  });

  it("rejects an invalid transition", () => {
    expect(() =>
      transitionExecutionStatus(execution, "SUCCEEDED", "2026-09-27T01:00:00.000Z"),
    ).toThrow(InvalidStateTransitionError);
  });
});
