import { describe, expect, it, vi } from "vitest";

import { InMemoryDomainStores } from "@polyon/storage";

import { MissionGraphExecutionService } from "./mission-graph-execution-service";

describe("MissionGraphExecutionService", () => {
  it("dispatches all currently-ready tasks from a persisted mission graph", () => {
    const stores = new InMemoryDomainStores();
    stores.missions.save({
      id: "mission-1",
      objective: "Execute graph",
      constraints: [],
      status: "RUNNING",
      taskIds: ["task-1", "task-2"],
      createdAt: "2026-09-28T00:00:00.000Z",
      updatedAt: "2026-09-28T00:00:00.000Z",
    });
    stores.tasks.save({
      id: "task-1",
      missionId: "mission-1",
      kind: "RESEARCH",
      title: "Research",
      description: "Research first.",
      status: "READY",
      dependsOn: [],
      createdAt: "2026-09-28T00:00:00.000Z",
      updatedAt: "2026-09-28T00:00:00.000Z",
    });
    stores.tasks.save({
      id: "task-2",
      missionId: "mission-1",
      kind: "CODING",
      title: "Code",
      description: "Code second.",
      status: "BLOCKED",
      dependsOn: ["task-1"],
      createdAt: "2026-09-28T00:00:00.000Z",
      updatedAt: "2026-09-28T00:00:00.000Z",
    });

    const dispatchReadyTasks = vi.fn(() => ({
      dispatched: [{ execution: { id: "execution-task-1-1" } }],
      awaitingApproval: [],
      rejected: [],
    }));

    const service = new MissionGraphExecutionService(
      stores.missions,
      stores.tasks,
      { dispatchReadyTasks } as never,
      stores,
    );

    const policy = {
      id: "policy",
      name: "Execution",
      description: "Execution policy.",
      approvalMode: "BALANCED" as const,
      rules: [],
      defaultEffect: "ALLOW" as const,
      enabled: true,
      createdAt: "2026-09-28T00:00:00.000Z",
      updatedAt: "2026-09-28T00:00:00.000Z",
    };

    const result = service.executeReadyTasks({
      missionId: "mission-1",
      actorId: "user-1",
      policy,
      riskLevel: "LOW",
      now: "2026-09-28T00:00:01.000Z",
      identities: {
        executionId: (taskId, attempt) => "execution-" + taskId + "-" + attempt,
        policyDecisionId: (taskId, executionId) => "decision-" + taskId + "-" + executionId,
        approvalRequestId: (taskId, executionId) => "approval-" + taskId + "-" + executionId,
      },
    });

    expect(dispatchReadyTasks).toHaveBeenCalledWith(
      expect.objectContaining({
        missionId: undefined,
      }),
    );
    expect(result.dispatched).toHaveLength(1);
  });
});
