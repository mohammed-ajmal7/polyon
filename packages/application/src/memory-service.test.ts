import { describe, expect, it, vi } from "vitest";

import { InMemoryDomainStores } from "@polyon/storage";

import { MemoryService } from "./memory-service";

describe("MemoryService", () => {
  it("stores memory and emits a trace event", () => {
    const stores = new InMemoryDomainStores();
    const service = new MemoryService(stores.memory, stores.events);

    const entry = service.remember({
      id: "memory-1",
      kind: "PREFERENCE",
      scope: "PRIVATE",
      text: "Prefer concise technical explanations.",
      tags: ["style", "technical"],
      now: "2026-09-28T00:00:00.000Z",
    });

    expect(entry.text).toBe("Prefer concise technical explanations.");
    expect(stores.memory.get("memory-1")).toEqual(entry);
    expect(stores.events.get("MEMORY_RECORDED:memory-1")).toMatchObject({
      kind: "MEMORY_RECORDED",
    });
  });

  it("ranks matching memories deterministically and enforces scope filters", () => {
    const stores = new InMemoryDomainStores();
    const service = new MemoryService(stores.memory, stores.events);

    service.remember({
      id: "m1",
      kind: "FACT",
      scope: "PRIVATE",
      text: "POLYON prefers explicit approval for email.",
      tags: ["approval"],
      now: "2026-09-28T00:00:00.000Z",
    });
    service.remember({
      id: "m2",
      kind: "FACT",
      scope: "PROJECT",
      text: "Email is an external communication capability.",
      tags: ["email"],
      now: "2026-09-28T00:00:01.000Z",
    });

    expect(service.search({ query: "approval email", scope: "PRIVATE" }).map((entry) => entry.id)).toEqual([
      "m1",
    ]);
    expect(service.search({ query: "email" }).map((entry) => entry.id)).toEqual(["m2", "m1"]);
  });

  it("rejects duplicate ids and bounds search results", () => {
    const stores = new InMemoryDomainStores();
    const service = new MemoryService(stores.memory, stores.events);

    service.remember({
      id: "m1",
      kind: "FACT",
      scope: "TASK",
      text: "A bounded fact.",
      now: "2026-09-28T00:00:00.000Z",
    });

    expect(() =>
      service.remember({
        id: "m1",
        kind: "FACT",
        scope: "TASK",
        text: "duplicate",
        now: "2026-09-28T00:00:00.000Z",
      }),
    ).toThrow("Memory already exists");

    expect(() => service.search({ query: "fact", limit: 101 })).toThrow(
      "between 1 and 100",
    );
  });
});
