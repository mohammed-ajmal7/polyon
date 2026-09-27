import { describe, expect, it, vi } from "vitest";
import { MissionWorkflowService } from "./mission-workflow-service";

describe("MissionWorkflowService", () => {
  it("stops before graph execution when plan approval is required", async () => {
    const graph = { executeReadyTasks: vi.fn() };
    const service = new MissionWorkflowService(
      { create: vi.fn(() => ({ mission: { id: "m1" }, conversation: {}, event: { id: "e1" } })) } as never,
      { transition: vi.fn() } as never,
      { plan: vi.fn(async () => ({ mission: { id: "m1" }, submission: { status: "APPROVAL_REQUIRED" as const } })) } as never,
      graph as never,
    );
    const result = await service.execute({
      missionId: "m1", conversationId: "c1", objective: "do", actorId: "u1", planningAgentId: "a1", requiredCapabilityIds: [],
      policy: { id: "p", name: "p", description: "p", approvalMode: "ASK_EVERYTHING", rules: [], defaultEffect: "REQUIRE_APPROVAL", enabled: true, createdAt: "2026-09-28T00:00:00.000Z", updatedAt: "2026-09-28T00:00:00.000Z" },
      riskLevel: "HIGH", proposalId: "p1", decisionId: "d1", approvalRequestId: "ap1", createdAt: "2026-09-28T00:00:00.000Z", planningAt: "2026-09-28T00:00:01.000Z",
      identities: { executionId: (t, a) => t + a, policyDecisionId: (t, e) => t + e, approvalRequestId: (t, e) => t + e },
    });
    expect(result.status).toBe("PLAN_APPROVAL_REQUIRED");
    expect(graph.executeReadyTasks).not.toHaveBeenCalled();
  });
});