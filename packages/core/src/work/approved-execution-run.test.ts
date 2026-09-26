import type { ApprovalRequest, Execution } from "@polyon/contracts";
import { describe, expect, it } from "vitest";

import {
  applyApprovedExecutionRun,
  ApprovedExecutionRunError,
} from "./approved-execution-run";

const execution: Execution = {
  id: "execution-1",
  missionId: "mission-1",
  taskId: "task-1",
  actorId: "agent-1",
  attempt: 1,
  status: "APPROVAL_REQUIRED",
  createdAt: "2026-09-27T01:00:00.000Z",
  updatedAt: "2026-09-27T01:00:00.000Z",
};

const approval: ApprovalRequest = {
  id: "approval-1",
  policyId: "policy-1",
  policyDecisionId: "decision-1",
  missionId: "mission-1",
  taskId: "task-1",
  executionId: "execution-1",
  action: "EXECUTION_RUN",
  riskLevel: "MEDIUM",
  requestedBy: "user-1",
  reason: "Execution requires approval.",
  status: "APPROVED",
  requestedAt: "2026-09-27T01:01:00.000Z",
};

const evaluatedAt = "2026-09-27T01:02:00.000Z";

describe("applyApprovedExecutionRun", () => {
  it("moves an approved execution to APPROVED", () => {
    expect(applyApprovedExecutionRun(approval, execution, evaluatedAt)).toEqual({
      ...execution,
      status: "APPROVED",
      updatedAt: evaluatedAt,
    });
  });

  it("does not mutate the approval or execution", () => {
    const approvalBefore = structuredClone(approval);
    const executionBefore = structuredClone(execution);

    applyApprovedExecutionRun(approval, execution, evaluatedAt);

    expect(approval).toEqual(approvalBefore);
    expect(execution).toEqual(executionBefore);
  });

  it.each(["PENDING", "REJECTED", "EXPIRED", "CANCELLED"] as const)(
    "rejects approval status %s",
    (status) => {
      expect(() =>
        applyApprovedExecutionRun({ ...approval, status }, execution, evaluatedAt),
      ).toThrowError(expect.objectContaining({ kind: "APPROVAL_NOT_APPROVED" }));
    },
  );

  it("rejects an expired approval at the exact expiry time", () => {
    expect(() =>
      applyApprovedExecutionRun(
        { ...approval, expiresAt: evaluatedAt },
        execution,
        evaluatedAt,
      ),
    ).toThrowError(expect.objectContaining({ kind: "APPROVAL_EXPIRED" }));
  });

  it("rejects an approval with the wrong action", () => {
    expect(() =>
      applyApprovedExecutionRun(
        { ...approval, action: "PLAN_APPLY" },
        execution,
        evaluatedAt,
      ),
    ).toThrowError(expect.objectContaining({ kind: "APPROVAL_ACTION_MISMATCH" }));
  });

  it("rejects an approval bound to another mission", () => {
    expect(() =>
      applyApprovedExecutionRun(
        { ...approval, missionId: "mission-2" },
        execution,
        evaluatedAt,
      ),
    ).toThrowError(expect.objectContaining({ kind: "APPROVAL_MISSION_MISMATCH" }));
  });

  it("rejects an approval bound to another task", () => {
    expect(() =>
      applyApprovedExecutionRun(
        { ...approval, taskId: "task-2" },
        execution,
        evaluatedAt,
      ),
    ).toThrowError(expect.objectContaining({ kind: "APPROVAL_TASK_MISMATCH" }));
  });

  it("rejects an approval bound to another execution", () => {
    expect(() =>
      applyApprovedExecutionRun(
        { ...approval, executionId: "execution-2" },
        execution,
        evaluatedAt,
      ),
    ).toThrowError(expect.objectContaining({ kind: "APPROVAL_EXECUTION_MISMATCH" }));
  });
});
