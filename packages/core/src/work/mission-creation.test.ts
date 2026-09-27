import { describe, expect, it } from "vitest";

import { createMission, MissionCreationError } from "./mission-creation";

describe("createMission", () => {
  it("creates a draft mission with independent constraint and task collections", () => {
    const constraints = ["Use local execution", "Do not publish externally"];
    const mission = createMission({
      id: "mission-1",
      objective: "Build the research plan.",
      constraints,
      createdAt: "2026-09-27T02:00:00.000Z",
    });

    constraints.push("Do not use paid services");

    expect(mission).toEqual({
      id: "mission-1",
      objective: "Build the research plan.",
      constraints: ["Use local execution", "Do not publish externally"],
      status: "DRAFT",
      taskIds: [],
      createdAt: "2026-09-27T02:00:00.000Z",
      updatedAt: "2026-09-27T02:00:00.000Z",
    });
  });

  it("rejects an empty objective", () => {
    expect(() =>
      createMission({
        id: "mission-1",
        objective: "   ",
        constraints: [],
        createdAt: "2026-09-27T02:00:00.000Z",
      }),
    ).toThrowError(MissionCreationError);

    try {
      createMission({
        id: "mission-1",
        objective: "   ",
        constraints: [],
        createdAt: "2026-09-27T02:00:00.000Z",
      });
    } catch (error) {
      expect(error).toMatchObject({
        kind: "OBJECTIVE_REQUIRED",
      });
    }
  });
});
