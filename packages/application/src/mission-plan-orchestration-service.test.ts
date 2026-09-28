import { describe, expect, it, vi } from "vitest";

import { InMemoryDomainStores } from "@polyon/storage";

import { MissionPlanOrchestrationService } from "./mission-plan-orchestration-service";

describe("MissionPlanOrchestrationService", () => {
  it("connects model planning to governed plan application and ready-task advancement", async () => {
    const stores = new InMemoryDomainStores();
    stores.missions.save({
      id: "mission-1",
      objective: "Build a service.",
      constraints: [],
      status: "PLANNING",
      taskIds: [],
      createdAt: "2026-09-28T00:00:00.000Z",
      updatedAt: "2026-09-28T00:00:00.000Z",
    });

    const planner = {
      generate: vi.fn(async () => ({
        rationale: "research then code",
        tasks: [
          {
            id: "mission-1:task:research",
            missionId: "mission-1",
            kind: "RESEARCH" as const,
            title: "Research",
            description: "Research.",
            status: "PENDING" as const,
            dependsOn: [],
            createdAt: "2026-09-28T00:00:00.000Z",
            updatedAt: "2026-09-28T00:00:00.000Z",
          },
          {
            id: "mission-1:task:code",
            missionId: "mission-1",
            kind: "CODING" as const,
            title: "Code",
            description: "Code.",
            status: "PENDING" as const,
            dependsOn: ["mission-1:task:research"],
            createdAt: "2026-09-28T00:00:00.000Z",
            updatedAt: "2026-09-28T00:00:00.000Z",
          },
        ],
        event: {
          id: "event-plan-generated",
          kind: "MISSION_PLAN_GENERATED" as const,
          missionId: "mission-1",
          occurredAt: "2026-09-28T00:00:00.000Z",
          data: {},
        },
      })),
    };

    const plans = {
      submit: vi.fn(() => ({
        status: "APPLIED" as const,
        mission: stores.missions.get("mission-1")!,
        proposal: {
          id: "proposal-1",
          missionId: "mission-1",
          taskIds: ["mission-1:task:research", "mission-1:task:code"],
          rationale: "research then code",
          createdBy: "planner",
          createdAt: "2026-09-28T00:00:00.000Z",
        },
        policyDecision: {
          id: "decision-1",
          policyId: "policy",
          action: "READ" as const,
          riskLevel: "LOW" as const,
          effect: "ALLOW" as const,
          reason: "safe",
          evaluatedAt: "2026-09-28T00:00:00.000Z",
        },
        events: [],
      })),
    };

    const advanceReadyTasks = vi.fn();
    const service = new MissionPlanOrchestrationService(
      stores.missions,
      planner as never,
      plans as never,
      { advanceReadyTasks },
      stores,
    );

    const policy = {
      id: "policy",
      name: "Planning",
      description: "Planning policy.",
      approvalMode: "BALANCED" as const,
      rules: [],
      defaultEffect: "ALLOW" as const,
      enabled: true,
      createdAt: "2026-09-28T00:00:00.000Z",
      updatedAt: "2026-09-28T00:00:00.000Z",
    };

    const result = await service.plan({
      missionId: "mission-1",
      planningAgentId: "planner",
      requiredCapabilityIds: [],
      proposalId: "proposal-1",
      decisionId: "decision-1",
      approvalRequestId: "approval-1",
      actorId: "user-1",
      policy,
      riskLevel: "LOW",
      createdAt: "2026-09-28T00:00:00.000Z",
      requestedAt: "2026-09-28T00:00:00.000Z",
      evaluatedAt: "2026-09-28T00:00:01.000Z",
    });

    expect(plans.submit).toHaveBeenCalledTimes(1);
    expect(advanceReadyTasks).toHaveBeenCalledWith({
      missionId: "mission-1",
      actorId: "user-1",
      now: "2026-09-28T00:00:01.000Z",
    });
    expect(result.submission.status).toBe("APPLIED");
  });
});
