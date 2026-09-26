import { describe, expect, it } from "vitest";

import { canTransitionApproval } from "./approval-lifecycle";

describe("canTransitionApproval", () => {
  it("allows a pending approval to be approved", () => {
    expect(canTransitionApproval("PENDING", "APPROVED")).toBe(true);
  });

  it("allows a pending approval to be rejected", () => {
    expect(canTransitionApproval("PENDING", "REJECTED")).toBe(true);
  });

  it("allows a pending approval to expire", () => {
    expect(canTransitionApproval("PENDING", "EXPIRED")).toBe(true);
  });

  it("allows a pending approval to be cancelled", () => {
    expect(canTransitionApproval("PENDING", "CANCELLED")).toBe(true);
  });

  it("does not allow an approved approval to change again", () => {
    expect(canTransitionApproval("APPROVED", "REJECTED")).toBe(false);
  });

  it("does not allow a rejected approval to change again", () => {
    expect(canTransitionApproval("REJECTED", "APPROVED")).toBe(false);
  });

  it("does not allow an expired approval to change again", () => {
    expect(canTransitionApproval("EXPIRED", "APPROVED")).toBe(false);
  });
});
