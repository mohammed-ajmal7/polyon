/// <reference path="../../storage/src/node-runtime.d.ts" />

import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { FileDomainStores, InMemoryDomainStores } from "@polyon/storage";
import { InMemoryExecutionQueue } from "@polyon/runtime";
import { describe, expect, it } from "vitest";

import { MemoryService } from "./memory-service";

describe("production-scale hardening", () => {
  it("keeps bounded memory search correct across 10,000 persisted in-memory records", () => {
    const stores = new InMemoryDomainStores();
    const memory = new MemoryService(stores.memory, stores.events);

    for (let index = 0; index < 10_000; index += 1) {
      memory.remember({
        id: "scale-memory-" + index,
        kind: "FACT",
        scope: index % 2 === 0 ? "PROJECT" : "TASK",
        text:
          index % 100 === 0
            ? "database recovery approval routing checkpoint " + index
            : "routine project memory " + index,
        tags: index % 100 === 0 ? ["scale", "recovery"] : ["scale"],
        now: "2026-09-28T00:00:00.000Z",
      });
    }

    const results = memory.search({
      query: "database recovery checkpoint",
      limit: 25,
    });

    expect(stores.memory.list()).toHaveLength(10_000);
    expect(results).toHaveLength(25);
    expect(results.every((entry) => entry.text.includes("database recovery"))).toBe(true);
  });

  it("recovers a bounded durable execution set after a file-backed restart", () => {
    const directory = mkdtempSync(join(tmpdir(), "polyon-production-scale-"));

    try {
      const first = new FileDomainStores(directory);
      for (let index = 0; index < 250; index += 1) {
        first.tasks.save({
          id: "task-" + index,
          missionId: "mission-scale",
          kind: "OTHER",
          title: "Scale task " + index,
          description: "Production recovery test.",
          status: "APPROVED",
          dependsOn: [],
          createdAt: "2026-09-28T00:00:00.000Z",
          updatedAt: "2026-09-28T00:00:00.000Z",
        });
        first.executions.save({
          id: "execution-" + index,
          missionId: "mission-scale",
          taskId: "task-" + index,
          actorId: "scale-test",
          attempt: 1,
          status: "QUEUED",
          createdAt: "2026-09-28T00:00:00.000Z",
          updatedAt: "2026-09-28T00:00:00.000Z",
        });
      }

      const second = new FileDomainStores(directory);
      const queue = new InMemoryExecutionQueue();

      const recovered = second.executions
        .list()
        .filter((execution) => execution.status === "QUEUED");

      for (const execution of recovered) queue.enqueue(execution);

      expect(recovered).toHaveLength(250);
      expect(queue.size()).toBe(250);
      expect(queue.peek()?.id).toBe("execution-0");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
