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

  it("bounds result size", () => {
    const stores = new InMemoryDomainStores();
    expect(() => new TraceQueryService(stores.events).list({ limit: 501 })).toThrow(
      "between 1 and 500",
    );
  });
});
