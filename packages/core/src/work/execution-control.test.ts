import type { Execution } from "@polyon/contracts";
import { describe, expect, it } from "vitest";

import {
  completeExecution,
  ExecutionControlError,
  pauseExecution,
  resumeExecution,
  startExecution,
} from "./execution-control";

const queuedExecution: Execution = {
  id: "execution-1",
  missionId: "mission-1",
  taskId: "task-1",
  actorId: "agent-1",
  attempt: 1,
  status: "QUEUED",
  createdAt: "2026-09-27T01:00:00.000Z",
  updatedAt: "2026-09-27T01:00:00.000Z",
};

describe("startExecution", () => {
  it("moves a queued execution to running and records startedAt", () => {
    expect(startExecution(queuedExecution, "2026-09-27T01:02:00.000Z")).toEqual({
      ...queuedExecution,
      status: "RUNNING",
      startedAt: "2026-09-27T01:02:00.000Z",
      updatedAt: "2026-09-27T01:02:00.000Z",
    });
  });

  it("rejects starting a paused execution directly", () => {
    const pausedExecution: Execution = {
      ...queuedExecution,
      status: "PAUSED",
      startedAt: "2026-09-27T01:02:00.000Z",
    };

    expect(() =>
      startExecution(pausedExecution, "2026-09-27T01:10:00.000Z"),
    ).toThrow();
  });

  it("does not mutate the original execution", () => {
    const before = structuredClone(queuedExecution);

    startExecution(queuedExecution, "2026-09-27T01:02:00.000Z");

    expect(queuedExecution).toEqual(before);
  });
});

describe("pauseExecution", () => {
  it("pauses a running execution", () => {
    const runningExecution: Execution = {
      ...queuedExecution,
      status: "RUNNING",
      startedAt: "2026-09-27T01:02:00.000Z",
    };

    expect(pauseExecution(runningExecution, "2026-09-27T01:03:00.000Z")).toEqual({
      ...runningExecution,
      status: "PAUSED",
      updatedAt: "2026-09-27T01:03:00.000Z",
    });
  });
});

describe("resumeExecution", () => {
  it("returns a paused execution to the queue", () => {
    const pausedExecution: Execution = {
      ...queuedExecution,
      status: "PAUSED",
      startedAt: "2026-09-27T01:02:00.000Z",
    };

    expect(resumeExecution(pausedExecution, "2026-09-27T01:10:00.000Z")).toEqual({
      ...pausedExecution,
      status: "QUEUED",
      updatedAt: "2026-09-27T01:10:00.000Z",
    });
  });

  it("does not mutate the original execution", () => {
    const before = structuredClone(queuedExecution);

    startExecution(queuedExecution, "2026-09-27T01:02:00.000Z");

    expect(queuedExecution).toEqual(before);
  });
});

describe("completeExecution", () => {
  const runningExecution: Execution = {
    ...queuedExecution,
    status: "RUNNING",
    startedAt: "2026-09-27T01:02:00.000Z",
  };

  it("completes a successful execution and records completedAt", () => {
    expect(
      completeExecution(runningExecution, {
        status: "SUCCEEDED",
        completedAt: "2026-09-27T01:05:00.000Z",
      }),
    ).toEqual({
      ...runningExecution,
      status: "SUCCEEDED",
      completedAt: "2026-09-27T01:05:00.000Z",
      updatedAt: "2026-09-27T01:05:00.000Z",
    });
  });

  it("completes a failed execution with its error", () => {
    expect(
      completeExecution(runningExecution, {
        status: "FAILED",
        completedAt: "2026-09-27T01:05:00.000Z",
        error: "Provider timed out.",
      }),
    ).toEqual({
      ...runningExecution,
      status: "FAILED",
      completedAt: "2026-09-27T01:05:00.000Z",
      updatedAt: "2026-09-27T01:05:00.000Z",
      error: "Provider timed out.",
    });
  });

  it("rejects an empty failure reason", () => {
    expect(() =>
      completeExecution(runningExecution, {
        status: "FAILED",
        completedAt: "2026-09-27T01:05:00.000Z",
        error: "   ",
      }),
    ).toThrowError(
      new ExecutionControlError(
        "FAILED_EXECUTION_REQUIRES_ERROR",
        "Failed executions require a non-empty error message.",
      ),
    );
  });

  it("completes a cancelled running execution", () => {
    expect(
      completeExecution(runningExecution, {
        status: "CANCELLED",
        completedAt: "2026-09-27T01:05:00.000Z",
      }).status,
    ).toBe("CANCELLED");
  });

  it("rejects completion from a non-running execution", () => {
    expect(() =>
      completeExecution(queuedExecution, {
        status: "SUCCEEDED",
        completedAt: "2026-09-27T01:05:00.000Z",
      }),
    ).toThrow();
  });

  it("does not mutate the original execution", () => {
    const before = structuredClone(runningExecution);

    completeExecution(runningExecution, {
      status: "SUCCEEDED",
      completedAt: "2026-09-27T01:05:00.000Z",
    });

    expect(runningExecution).toEqual(before);
  });
});
