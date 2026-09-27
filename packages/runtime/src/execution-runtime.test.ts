/// <reference path="../../storage/src/node-runtime.d.ts" />

import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import type { Execution, Task } from "@polyon/contracts";
import { FileDomainStores, InMemoryDomainStores } from "@polyon/storage";
import { describe, expect, it } from "vitest";

import { createExecutionRuntime } from "./execution-runtime";

const execution: Execution = {
  id: "execution-1",
  missionId: "mission-1",
  taskId: "task-1",
  actorId: "agent-1",
  attempt: 1,
  status: "QUEUED",
  createdAt: "2026-09-27T01:00:00.000Z",
  updatedAt: "2026-09-27T01:00:00.000Z",
};

const task: Task = {
  id: "task-1",
  missionId: "mission-1",
  kind: "CODING",
  title: "Build runtime",
  description: "Implement runtime.",
  status: "APPROVED",
  dependsOn: [],
  createdAt: "2026-09-27T01:00:00.000Z",
  updatedAt: "2026-09-27T01:00:00.000Z",
};

describe("createExecutionRuntime", () => {
  it("constructs the queue, coordinator, and worker around the supplied stores", async () => {
    const stores = new InMemoryDomainStores();

    stores.tasks.save(task);
    stores.executions.save(execution);

    const runtime = createExecutionRuntime({
      runner: {
        async run() {
          return { status: "SUCCEEDED", output: "Completed." };
        },
      },
      executions: stores.executions,
      tasks: stores.tasks,
      events: stores.events,
      clock: {
        now: () => "2026-09-27T01:05:00.000Z",
      },
    });

    expect(runtime.queue.size()).toBe(0);
    expect(runtime.worker.running).toBe(false);

    const startup = runtime.start();

    expect(startup.recoveredExecutionIds).toEqual(["execution-1"]);
    expect(runtime.queue.size()).toBe(1);
    expect(runtime.recoveredExecutionIds()).toEqual(["execution-1"]);

    const outcome = await runtime.worker.runNext();

    expect(outcome?.execution.status).toBe("SUCCEEDED");
    expect(runtime.queue.size()).toBe(0);

    runtime.stop();

    expect(runtime.worker.running).toBe(false);
  });

  it("recovers durable queued work when a fresh runtime is created after restart", async () => {
    const directory = mkdtempSync(join(tmpdir(), "polyon-execution-runtime-"));

    try {
      const firstProcessStores = new FileDomainStores(directory);
      firstProcessStores.tasks.save(task);
      firstProcessStores.executions.save(execution);

      const secondProcessStores = new FileDomainStores(directory);
      const runtime = createExecutionRuntime({
        runner: {
          async run(currentExecution) {
            expect(currentExecution.id).toBe("execution-1");
            expect(currentExecution.status).toBe("RUNNING");
            return {
              status: "SUCCEEDED",
              output: "Recovered after startup.",
            };
          },
        },
        executions: secondProcessStores.executions,
        tasks: secondProcessStores.tasks,
        events: secondProcessStores.events,
        clock: {
          now: () => "2026-09-27T01:05:00.000Z",
        },
      });

      expect(runtime.queue.size()).toBe(0);

      const startup = runtime.start();

      expect(startup.recoveredExecutionIds).toEqual(["execution-1"]);
      expect(runtime.queue.peek()?.id).toBe("execution-1");

      const outcome = await runtime.worker.runNext();

      expect(outcome?.execution.status).toBe("SUCCEEDED");
      expect(outcome?.result.output).toBe("Recovered after startup.");
      expect(new FileDomainStores(directory).executions.get("execution-1")?.status).toBe(
        "SUCCEEDED",
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
