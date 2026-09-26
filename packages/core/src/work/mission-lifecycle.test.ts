import { describe, expect, it } from "vitest";

import { canTransitionMission } from "./mission-lifecycle";

describe("canTransitionMission", () => {
  it("allows a draft mission to enter planning", () => {
    expect(canTransitionMission("DRAFT", "PLANNING")).toBe(true);
  });

  it("allows planning to wait", () => {
    expect(canTransitionMission("PLANNING", "WAITING")).toBe(true);
  });

  it("allows a waiting mission to resume planning", () => {
    expect(canTransitionMission("WAITING", "PLANNING")).toBe(true);
  });

  it("allows a running mission to pause", () => {
    expect(canTransitionMission("RUNNING", "PAUSED")).toBe(true);
  });

  it("rejects restarting a succeeded mission", () => {
    expect(canTransitionMission("SUCCEEDED", "RUNNING")).toBe(false);
  });

  it("rejects moving a cancelled mission back into execution", () => {
    expect(canTransitionMission("CANCELLED", "RUNNING")).toBe(false);
  });
});
