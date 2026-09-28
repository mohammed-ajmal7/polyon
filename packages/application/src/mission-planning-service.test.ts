import { describe, expect, it, vi } from "vitest";

import { InMemoryDomainStores } from "@polyon/storage";

import { MissionPlanningService } from "./mission-planning-service";

describe("MissionPlanningService", () => {
  it("turns structured model JSON into a persisted, validated task graph", async () => {
    const stores = new InMemoryDomainStores();
    const service = new MissionPlanningService(
      {
        invokeText: vi.fn(async () => ({
          agentId: "planner",
          modelId: "model",
          providerId: "provider",
          source: "preferred" as const,
          output: {
            content: JSON.stringify({
              rationale: "Split the work into research then implementation.",
              tasks: [
                {
                  id: "research",
                  kind: "RESEARCH",
                  title: "Research constraints",
                  description: "Gather the relevant constraints.",
                  dependsOn: [],
                },
                {
                  id: "implementation",
                  kind: "CODING",
                  title: "Implement",
                  description: "Implement the validated design.",
                  dependsOn: ["research"],
                },
              ],
            }),
          },
        })),
      } as never,
      stores.tasks,
      stores.events,
      stores,
    );

    const result = await service.generate({
      mission: {
        id: "mission-1",
        objective: "Build a bounded system.",
        constraints: [],
        status: "PLANNING",
        taskIds: [],
        createdAt: "2026-09-28T00:00:00.000Z",
        updatedAt: "2026-09-28T00:00:00.000Z",
      },
      planningAgentId: "planner",
      requiredCapabilityIds: [],
      now: "2026-09-28T00:00:00.000Z",
    });

    expect(result.tasks.map((task) => task.id)).toEqual([
      "mission-1:task:research",
      "mission-1:task:implementation",
    ]);
    expect(result.tasks[1]?.dependsOn).toEqual(["mission-1:task:research"]);
    expect(
      stores.events.get("MISSION_PLAN_GENERATED:mission-1:2026-09-28T00:00:00.000Z"),
    ).toBeDefined();
  });

  it("rejects cyclic plans before persistence", async () => {
    const stores = new InMemoryDomainStores();
    const service = new MissionPlanningService(
      {
        invokeText: vi.fn(async () => ({
          agentId: "planner",
          modelId: "model",
          providerId: "provider",
          source: "preferred" as const,
          output: {
            content: JSON.stringify({
              rationale: "cycle",
              tasks: [
                { id: "a", kind: "OTHER", title: "A", description: "A", dependsOn: ["b"] },
                { id: "b", kind: "OTHER", title: "B", description: "B", dependsOn: ["a"] },
              ],
            }),
          },
        })),
      } as never,
      stores.tasks,
      stores.events,
      stores,
    );

    await expect(
      service.generate({
        mission: {
          id: "mission-2",
          objective: "Test cycle.",
          constraints: [],
          status: "PLANNING",
          taskIds: [],
          createdAt: "2026-09-28T00:00:00.000Z",
          updatedAt: "2026-09-28T00:00:00.000Z",
        },
        planningAgentId: "planner",
        requiredCapabilityIds: [],
        now: "2026-09-28T00:00:00.000Z",
      }),
    ).rejects.toThrow("deterministic task-graph validation");

    expect(stores.tasks.list()).toHaveLength(0);
  });
});
