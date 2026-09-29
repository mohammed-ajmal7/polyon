import { describe, expect, it } from "vitest";

import { InMemoryDomainStores } from "@polyon/storage";

import { TraceQueryService } from "./trace-query-service";

describe("TraceQueryService", () => {
  it("filters and redacts durable events deterministically", () => {
    const stores = new InMemoryDomainStores();
    stores.events.append({
      id: "event-2",
      kind: "MESSAGE_CREATED",
      occurredAt: "2026-09-28T00:00:02.000Z",
      missionId: "mission-1",
      data: { password: "do-not-return", value: "safe" },
    });
    stores.events.append({
      id: "event-1",
      kind: "MISSION_CREATED",
      occurredAt: "2026-09-28T00:00:01.000Z",
      missionId: "mission-1",
      data: { objective: "test" },
    });

    const result = new TraceQueryService(stores.events).list({
      missionId: "mission-1",
    });

    expect(result.map((event) => event.id)).toEqual(["event-1", "event-2"]);
    expect(result[1]?.data).toEqual({ value: "safe" });
  });

  it("filters traces by agent run", () => {
    const stores = new InMemoryDomainStores();
    stores.events.append({
      id: "run-1-model",
      kind: "MODEL_INVOCATION_RECORDED",
      agentRunId: "run-1",
      occurredAt: "2026-09-28T00:00:01.000Z",
      data: { providerId: "provider-a", modelId: "model-a", latencyMs: 10 },
    });
    stores.events.append({
      id: "run-2-model",
      kind: "MODEL_INVOCATION_RECORDED",
      agentRunId: "run-2",
      occurredAt: "2026-09-28T00:00:02.000Z",
      data: { providerId: "provider-b", modelId: "model-b", latencyMs: 20 },
    });

    const result = new TraceQueryService(stores.events).list({
      agentRunId: "run-1",
    });

    expect(result.map((event) => event.id)).toEqual(["run-1-model"]);
    expect(result[0]?.agentRunId).toBe("run-1");
  });

  it("bounds result size", () => {
    const stores = new InMemoryDomainStores();
    expect(() => new TraceQueryService(stores.events).list({ limit: 501 })).toThrow(
      "between 1 and 500",
    );
  });
});
