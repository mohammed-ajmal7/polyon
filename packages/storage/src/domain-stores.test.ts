import type { Execution, Mission } from "@polyon/contracts";
import { describe, expect, it } from "vitest";

import { InMemoryDomainStores } from "./domain-stores";

const mission: Mission = {
  id: "mission-1",
  objective: "Build POLYON",
  constraints: [],
  status: "RUNNING",
  taskIds: [],
  createdAt: "2026-09-27T01:00:00.000Z",
  updatedAt: "2026-09-27T01:00:00.000Z",
};

const execution: Execution = {
  id: "execution-1",
  missionId: "mission-1",
  taskId: "task-1",
  actorId: "agent-1",
  attempt: 1,
  status: "PENDING",
  createdAt: "2026-09-27T01:00:00.000Z",
  updatedAt: "2026-09-27T01:00:00.000Z",
};

describe("InMemoryDomainStores", () => {
  it("provides independent stores for each domain entity", () => {
    const stores = new InMemoryDomainStores();

    stores.missions.save(mission);
    stores.executions.save(execution);

    expect(stores.missions.get("mission-1")).toEqual(mission);
    expect(stores.executions.get("execution-1")).toEqual(execution);
    expect(stores.tasks.get("mission-1")).toBeUndefined();
    expect(stores.artifacts.get("execution-1")).toBeUndefined();
  });
});
