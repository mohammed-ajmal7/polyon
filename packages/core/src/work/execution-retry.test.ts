import type { Execution } from "@polyon/contracts";
import { describe, expect, it } from "vitest";

import { createRetryExecution, ExecutionRetryError } from "./execution-retry";

const failedExecution: Execution = {
  id: "execution-1",
  missionId: "mission-1",
  taskId: "task-1",
  actorId: "agent-1",
  attempt: 1,
  status: "FAILED",
  startedAt: "2026-09-27T01:02:00.000Z",
  completedAt: "2026-09-27T01:05:00.000Z",
  createdAt: "2026-09-27T01:00:00.000Z",
  updatedAt: "2026-09-27T01:05:00.000Z",
  error: "Provider timed out.",
};

const input = {
  id: "execution-2",
  actorId: "agent-2",
  createdAt: "2026-09-27T01:10:00.000Z",
};

describe("createRetryExecution", () => {
  it("creates a new pending execution with the next attempt", () => {
    expect(createRetryExecution(failedExecution, input)).toEqual({
      id: "execution-2",
      missionId: "mission-1",
      taskId: "task-1",
      actorId: "agent-2",
      attempt: 2,
      status: "PENDING",
      createdAt: "2026-09-27T01:10:00.000Z",
      updatedAt: "2026-09-27T01:10:00.000Z",
    });
  });

  it("preserves the logical agent when no replacement agent is supplied", () => {
    const retry = createRetryExecution(
      {
        ...failedExecution,
        agentId: "agent-1",
      },
      input,
    );

    expect(retry.agentId).toBe("agent-1");
  });

  it("allows a retry to switch the logical agent", () => {
    const retry = createRetryExecution(
      {
        ...failedExecution,
        agentId: "agent-1",
      },
      {
        ...input,
        agentId: "agent-2",
      },
    );

    expect(retry.agentId).toBe("agent-2");
  });

  it("does not carry failure state into the retry", () => {
    const retry = createRetryExecution(failedExecution, input);

    expect(retry.startedAt).toBeUndefined();
    expect(retry.completedAt).toBeUndefined();
    expect(retry.error).toBeUndefined();
  });

  it("does not mutate the failed execution", () => {
    const before = structuredClone(failedExecution);

    createRetryExecution(failedExecution, input);

    expect(failedExecution).toEqual(before);
  });

  it("allows the retry to use a different actor", () => {
    const retry = createRetryExecution(failedExecution, {
      ...input,
      actorId: "agent-3",
    });

    expect(retry.actorId).toBe("agent-3");
  });

  it.each([
    "PENDING",
    "APPROVAL_REQUIRED",
    "APPROVED",
    "QUEUED",
    "RUNNING",
    "PAUSED",
    "SUCCEEDED",
    "CANCELLED",
    "REJECTED",
  ] as const)("rejects non-failed execution status %s", (status) => {
    expect(() =>
      createRetryExecution(
        {
          ...failedExecution,
          status,
        },
        input,
      ),
    ).toThrowError(ExecutionRetryError);
  });

  it("increments only the attempt number", () => {
    const retry = createRetryExecution(
      {
        ...failedExecution,
        attempt: 7,
      },
      input,
    );

    expect(retry.attempt).toBe(8);
  });
});
