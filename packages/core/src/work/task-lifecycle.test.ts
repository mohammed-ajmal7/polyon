import { describe, expect, it } from "vitest";

import { canTransitionTask } from "./task-lifecycle";

describe("canTransitionTask", () => {
  it("allows a valid transition", () => {
    expect(canTransitionTask("PENDING", "READY")).toBe(true);
  });

  it("rejects an invalid transition", () => {
    expect(canTransitionTask("PENDING", "SUCCEEDED")).toBe(false);
  });

  it("allows pausing a running task", () => {
    expect(canTransitionTask("RUNNING", "PAUSED")).toBe(true);
  });

  it("does not allow a completed task to run again", () => {
    expect(canTransitionTask("SUCCEEDED", "RUNNING")).toBe(false);
  });

  it("allows an approved task to enter execution", () => {
    expect(canTransitionTask("APPROVED", "RUNNING")).toBe(true);
  });
});
