import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, it } from "vitest";

import { AgentRunService } from "./agent-run-service";
import { FileDomainStores, InMemoryDomainStores } from "@polyon/storage";

function createRunService() {
  const stores = new InMemoryDomainStores();
  return {
    stores,
    service: new AgentRunService({
      agentRuns: stores.agentRuns,
      messages: stores.messages,
      events: stores.events,
      conversations: stores.conversations,
      unitOfWork: stores,
    }),
  };
}

const baseInput = {
  id: "run-1",
  userId: "user-1",
  task: "Investigate an incident.",
  mode: "deep" as const,
  agentIds: ["researcher", "analyst"],
  createdAt: "2026-09-29T01:00:00.000Z",
};

describe("AgentRunService", () => {
  it("creates runs in queued state and records a creation event", () => {
    const { stores, service } = createRunService();

    const run = service.create(baseInput);

    expect(run.status).toBe("queued");
    expect(stores.agentRuns.get("run-1")).toEqual(run);
    expect(stores.events.list()).toContainEqual(
      expect.objectContaining({
        kind: "AGENT_RUN_CREATED",
        agentRunId: "run-1",
      }),
    );
  });

  it("enforces queued -> running -> completed lifecycle", () => {
    const { stores, service } = createRunService();

    service.create(baseInput);
    const started = service.start("run-1", "2026-09-29T01:01:00.000Z");
    const completed = service.complete({
      id: "run-1",
      finalAnswer: "Investigation completed.",
      completedAt: "2026-09-29T01:02:00.000Z",
    });

    expect(started.status).toBe("running");
    expect(completed).toMatchObject({
      status: "completed",
      startedAt: "2026-09-29T01:01:00.000Z",
      completedAt: "2026-09-29T01:02:00.000Z",
      finalAnswer: "Investigation completed.",
    });
    expect(stores.events.list().filter((event) => event.kind === "AGENT_RUN_STATUS_CHANGED")).toHaveLength(2);
  });

  it("rejects invalid lifecycle transitions", () => {
    const { service } = createRunService();
    service.create(baseInput);

    expect(() => service.complete({
      id: "run-1",
      finalAnswer: "Too early.",
      completedAt: "2026-09-29T01:02:00.000Z",
    })).toThrow("queued -> completed");

    service.start("run-1", "2026-09-29T01:01:00.000Z");
    service.complete({
      id: "run-1",
      finalAnswer: "Done.",
      completedAt: "2026-09-29T01:02:00.000Z",
    });

    expect(() => service.start("run-1", "2026-09-29T01:03:00.000Z")).toThrow(
      "completed -> running",
    );
  });

  it("records a terminal failure", () => {
    const { service } = createRunService();
    service.create(baseInput);
    service.start("run-1", "2026-09-29T01:01:00.000Z");

    const failed = service.fail({
      id: "run-1",
      error: "Provider unavailable.",
      completedAt: "2026-09-29T01:02:00.000Z",
    });

    expect(failed).toMatchObject({
      status: "failed",
      error: "Provider unavailable.",
      completedAt: "2026-09-29T01:02:00.000Z",
    });
  });

  it("syncs durable message references into a run", () => {
    const { stores, service } = createRunService();
    service.create(baseInput);

    stores.conversations.save({
      id: "conversation-1",
      kind: "COLLABORATIVE",
      status: "ACTIVE",
      participantIds: ["user-1", "researcher"],
      messageIds: ["message-1"],
      createdAt: baseInput.createdAt,
      updatedAt: baseInput.createdAt,
    });
    stores.messages.save({
      id: "message-1",
      conversationId: "conversation-1",
      actorId: "researcher",
      role: "AGENT",
      kind: "TEXT",
      content: "Finding",
      runId: "run-1",
      fromAgentId: "researcher",
      agentMessageType: "finding",
      payload: { claim: "test" },
      createdAt: baseInput.createdAt,
    });

    const synced = service.syncMessageIds("run-1");

    expect(synced.messageIds).toEqual(["message-1"]);
  });

  it("survives restart with the run and lifecycle trace intact", () => {
    const root = mkdtempSync(join(tmpdir(), "polyon-agent-run-"));

    try {
      const first = new FileDomainStores(root);
      const firstService = new AgentRunService({
        agentRuns: first.agentRuns,
        messages: first.messages,
        events: first.events,
        conversations: first.conversations,
        unitOfWork: first,
      });

      firstService.create(baseInput);
      firstService.start("run-1", "2026-09-29T01:01:00.000Z");

      const reopened = new FileDomainStores(root);
      const reopenedService = new AgentRunService({
        agentRuns: reopened.agentRuns,
        messages: reopened.messages,
        events: reopened.events,
        conversations: reopened.conversations,
        unitOfWork: reopened,
      });

      expect(reopenedService.get("run-1")).toMatchObject({
        status: "running",
        startedAt: "2026-09-29T01:01:00.000Z",
      });
      expect(
        reopened.events.list().filter((event) => event.agentRunId === "run-1"),
      ).toHaveLength(2);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
