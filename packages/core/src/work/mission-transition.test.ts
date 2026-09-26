import { describe, expect, it } from "vitest";

import { transitionMissionStatus } from "./mission-transition";
import { InvalidStateTransitionError } from "./transition-error";

const mission = {
  id: "mission-1",
  objective: "Build POLYON",
  constraints: [],
  status: "DRAFT" as const,
  taskIds: [],
  createdAt: "2026-09-27T00:00:00.000Z",
  updatedAt: "2026-09-27T00:00:00.000Z",
};

describe("transitionMissionStatus", () => {
  it("returns a new mission with the new status", () => {
    const updated = transitionMissionStatus(mission, "PLANNING", "2026-09-27T01:00:00.000Z");

    expect(updated.status).toBe("PLANNING");
    expect(updated.updatedAt).toBe("2026-09-27T01:00:00.000Z");
  });

  it("does not mutate the original mission", () => {
    const updated = transitionMissionStatus(mission, "PLANNING", "2026-09-27T01:00:00.000Z");

    expect(mission.status).toBe("DRAFT");
    expect(updated).not.toBe(mission);
  });

  it("rejects an invalid transition", () => {
    expect(() => transitionMissionStatus(mission, "SUCCEEDED", "2026-09-27T01:00:00.000Z")).toThrow(
      InvalidStateTransitionError,
    );
  });
});
