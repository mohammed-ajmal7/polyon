import { describe, expect, it } from "vitest";

import { canTransitionExecution } from "./execution-lifecycle";

describe("canTransitionExecution", () => {
  it("allows a pending execution to enter the queue", () => {
    expect(canTransitionExecution("PENDING", "QUEUED")).toBe(true);
  });

  it("allows a pending execution to require approval", () => {
    expect(canTransitionExecution("PENDING", "APPROVAL_REQUIRED")).toBe(true);
  });

  it("allows an approved execution to enter the queue", () => {
    expect(canTransitionExecution("APPROVED", "QUEUED")).toBe(true);
  });

  it("rejects running an execution before approval", () => {
    expect(canTransitionExecution("APPROVAL_REQUIRED", "RUNNING")).toBe(false);
  });

  it("requires an approved execution to enter the queue before running", () => {
    expect(canTransitionExecution("APPROVED", "RUNNING")).toBe(false);
  });

  it("allows a queued execution to start running", () => {
    expect(canTransitionExecution("QUEUED", "RUNNING")).toBe(true);
  });

  it("allows a running execution to pause", () => {
    expect(canTransitionExecution("RUNNING", "PAUSED")).toBe(true);
  });

  it("allows a paused execution to return to the queue", () => {
    expect(canTransitionExecution("PAUSED", "QUEUED")).toBe(true);
  });

  it("rejects restarting a succeeded execution", () => {
    expect(canTransitionExecution("SUCCEEDED", "RUNNING")).toBe(false);
  });

  it("rejects restarting a failed execution", () => {
    expect(canTransitionExecution("FAILED", "QUEUED")).toBe(false);
  });

  it("rejects moving a cancelled execution back into the queue", () => {
    expect(canTransitionExecution("CANCELLED", "QUEUED")).toBe(false);
  });
});
