import type { Mission, Policy, Task } from "@polyon/contracts";
import { InMemoryDomainStores, InMemoryEventStore } from "@polyon/storage";
import { describe, expect, it } from "vitest";

import {
  MissionPlanService,
  MissionPlanServiceError,
} from "./mission-plan-service";

const mission: Mission = {
  id: "mission-1",
  objective: "Build POLYON",
  constraints: [],
  status: "PLANNING",
  taskIds: [],
  createdAt: "2026-09-27T02:00:00.000Z",
  updatedAt: "2026-09-27T02:00:00.000Z",
};

function createTask(id: string, dependsOn: readonly string[] = []): Task {
  return {
    id,
    missionId: mission.id,
    kind: "CODING",
    title: id,
    description: `Task ${id}`,
    status: "PENDING",
    dependsOn,
    createdAt: "2026-09-27T02:00:00.000Z",
    updatedAt: "2026-09-27T02:00:00.000Z",
  };
}

function createPolicy(
  defaultEffect: Policy["defaultEffect"],
  actionEffect?: Policy["defaultEffect"],
): Policy {
  return {
    id: "policy-1",
    name: "Mission plan policy",
    description: "Controls mission plan changes.",
    approvalMode: "BALANCED",
    rules:
      actionEffect === undefined
        ? []
        : [
            {
              priority: 100,
              action: "PLAN_APPLY",
              riskLevel: "HIGH",
              effect: actionEffect,
            },
          ],
    defaultEffect,
    enabled: true,
    createdAt: "2026-09-27T02:00:00.000Z",
    updatedAt: "2026-09-27T02:00:00.000Z",
  };
}

function createService() {
  const stores = new InMemoryDomainStores();
  const events = new InMemoryEventStore();

  stores.missions.save(mission);
  stores.tasks.save(createTask("task-1"));
  stores.tasks.save(createTask("task-2", ["task-1"]));

  return {
    stores,
    events,
    service: new MissionPlanService({
      missions: stores.missions,
      tasks: stores.tasks,
      proposals: stores.missionPlanProposals,
      policyDecisions: stores.policyDecisions,
      approvals: stores.approvals,
      events,
    }),
  };
}

const baseInput = {
  missionId: "mission-1",
  proposalId: "proposal-1",
  taskIds: ["task-1", "task-2"],
  rationale: "Build the system in dependency order.",
  createdBy: "agent-1",
  createdAt: "2026-09-27T02:10:00.000Z",
  decisionId: "decision-1",
  approvalRequestId: "approval-1",
  requestedBy: "user-1",
  requestedAt: "2026-09-27T02:11:00.000Z",
  evaluatedAt: "2026-09-27T02:12:00.000Z",
  riskLevel: "HIGH" as const,
};

describe("MissionPlanService", () => {
  it("applies an allowed plan, persists the decision, and emits a linked trace", () => {
    const { stores, events, service } = createService();

    const result = service.submit({
      ...baseInput,
      policy: createPolicy("ALLOW"),
      appliedAt: "2026-09-27T02:13:00.000Z",
    });

    expect(result.status).toBe("APPLIED");
    expect(result.mission.taskIds).toEqual(["task-1", "task-2"]);
    expect(result.mission.updatedAt).toBe("2026-09-27T02:13:00.000Z");
    expect(stores.missions.get("mission-1")?.taskIds).toEqual(["task-1", "task-2"]);
    expect(stores.missionPlanProposals.get("proposal-1")).toEqual(result.proposal);
    expect(stores.policyDecisions.get("decision-1")).toEqual(result.policyDecision);
    expect(stores.approvals.get("approval-1")).toBeUndefined();
    expect(events.list().map((event) => event.kind)).toEqual([
      "MISSION_PLAN_PROPOSED",
      "POLICY_DECIDED",
      "MISSION_PLAN_APPLIED",
    ]);
    expect(events.listByMission("mission-1")[1]?.causedByEventId).toBe(
      "MISSION_PLAN_PROPOSED:proposal-1",
    );
    expect(events.listByMission("mission-1")[2]?.causedByEventId).toBe(
      "POLICY_DECIDED:decision-1",
    );
  });

  it("persists an approval request without applying the plan", () => {
    const { stores, events, service } = createService();

    const result = service.submit({
      ...baseInput,
      policy: createPolicy("REQUIRE_APPROVAL"),
    });

    expect(result.status).toBe("APPROVAL_REQUIRED");
    expect(result.approvalRequest?.status).toBe("PENDING");
    expect(stores.missions.get("mission-1")?.taskIds).toEqual([]);
    expect(stores.approvals.get("approval-1")).toEqual(result.approvalRequest);
    expect(events.list().map((event) => event.kind)).toEqual([
      "MISSION_PLAN_PROPOSED",
      "POLICY_DECIDED",
      "APPROVAL_REQUESTED",
    ]);
  });

  it("persists a policy denial but does not alter the mission", () => {
    const { stores, events, service } = createService();

    const result = service.submit({
      ...baseInput,
      policy: createPolicy("DENY"),
    });

    expect(result.status).toBe("DENIED");
    expect(result.policyDecision.effect).toBe("DENY");
    expect(stores.missionPlanProposals.get("proposal-1")).toEqual(result.proposal);
    expect(stores.policyDecisions.get("decision-1")).toEqual(result.policyDecision);
    expect(stores.missions.get("mission-1")?.taskIds).toEqual([]);
    expect(events.list().map((event) => event.kind)).toEqual([
      "MISSION_PLAN_PROPOSED",
      "POLICY_DECIDED",
    ]);
  });

  it("rejects an invalid proposal before persisting it or evaluating policy", () => {
    const { stores, events, service } = createService();

    expect(() =>
      service.submit({
        ...baseInput,
        taskIds: ["task-1", "missing-task"],
        policy: createPolicy("ALLOW"),
      }),
    ).toThrow();

    expect(stores.missionPlanProposals.get("proposal-1")).toBeUndefined();
    expect(stores.policyDecisions.get("decision-1")).toBeUndefined();
    expect(events.list()).toEqual([]);
  });

  it("does not allow planning against a mission in a terminal or running state", () => {
    const { stores, service } = createService();

    stores.missions.save({
      ...mission,
      status: "RUNNING",
    });

    expect(() =>
      service.submit({
        ...baseInput,
        policy: createPolicy("ALLOW"),
      }),
    ).toThrowError(
      new MissionPlanServiceError(
        "MISSION_NOT_PLANNING",
        "Cannot apply a plan while mission mission-1 is RUNNING.",
      ),
    );
  });

  it("applies an approved plan through the approval resolution path", () => {
    const { stores, events, service } = createService();

    const pending = service.submit({
      ...baseInput,
      policy: createPolicy("REQUIRE_APPROVAL"),
    });

    const approval = pending.approvalRequest!;
    const result = service.resolveApproval({
      approvalId: approval.id,
      status: "APPROVED",
      resolvedAt: "2026-09-27T02:20:00.000Z",
      resolvedBy: "user-1",
    });

    expect(result.status).toBe("APPLIED");
    expect(result.approval.status).toBe("APPROVED");
    expect(result.mission.taskIds).toEqual(["task-1", "task-2"]);
    expect(result.mission.updatedAt).toBe("2026-09-27T02:20:00.000Z");
    expect(stores.approvals.get("approval-1")?.status).toBe("APPROVED");
    expect(stores.missions.get("mission-1")?.taskIds).toEqual(["task-1", "task-2"]);
    expect(events.list().map((event) => event.kind)).toEqual([
      "MISSION_PLAN_PROPOSED",
      "POLICY_DECIDED",
      "APPROVAL_REQUESTED",
      "APPROVAL_RESOLVED",
      "MISSION_PLAN_APPLIED",
    ]);
  });

  it.each(["REJECTED", "EXPIRED", "CANCELLED"] as const)(
    "resolves a %s approval without applying the plan",
    (status) => {
      const { stores, service } = createService();

      service.submit({
        ...baseInput,
        policy: createPolicy("REQUIRE_APPROVAL"),
      });

      const result = service.resolveApproval({
        approvalId: "approval-1",
        status,
        resolvedAt: "2026-09-27T02:20:00.000Z",
        resolvedBy: "user-1",
      });

      expect(result.status).toBe(status);
      expect(result.approval.status).toBe(status);
      expect(result.mission.taskIds).toEqual([]);
      expect(stores.missions.get("mission-1")?.taskIds).toEqual([]);
    },
  );

  it("does not consume an expired approval when a later approval attempt reaches the plan", () => {
    const { stores, service } = createService();

    service.submit({
      ...baseInput,
      policy: createPolicy("REQUIRE_APPROVAL"),
      expiresAt: "2026-09-27T02:15:00.000Z",
    });

    expect(() =>
      service.resolveApproval({
        approvalId: "approval-1",
        status: "APPROVED",
        resolvedAt: "2026-09-27T02:16:00.000Z",
        resolvedBy: "user-1",
      }),
    ).toThrow();

    expect(stores.approvals.get("approval-1")?.status).toBe("PENDING");
    expect(stores.missions.get("mission-1")?.taskIds).toEqual([]);
  });

  it("rejects missing approval identities", () => {
    const { service } = createService();

    expect(() =>
      service.resolveApproval({
        approvalId: "missing-approval",
        status: "APPROVED",
        resolvedAt: "2026-09-27T02:20:00.000Z",
      }),
    ).toThrowError(
      new MissionPlanServiceError(
        "APPROVAL_NOT_FOUND",
        "Approval request not found: missing-approval.",
      ),
    );
  });

  it("rejects applying a non-plan approval", () => {
    const { stores, service } = createService();

    stores.approvals.save({
      id: "approval-1",
      policyId: "policy-1",
      policyDecisionId: "decision-1",
      missionId: "mission-1",
      executionId: "execution-1",
      action: "EXECUTION_RUN",
      riskLevel: "HIGH",
      requestedBy: "user-1",
      reason: "Execution approval.",
      status: "PENDING",
      requestedAt: "2026-09-27T02:11:00.000Z",
    });

    expect(() =>
      service.resolveApproval({
        approvalId: "approval-1",
        status: "APPROVED",
        resolvedAt: "2026-09-27T02:20:00.000Z",
      }),
    ).toThrowError(
      new MissionPlanServiceError(
        "APPROVAL_ACTION_MISMATCH",
        "Approval does not authorize mission plan application: EXECUTION_RUN.",
      ),
    );
  });
});
