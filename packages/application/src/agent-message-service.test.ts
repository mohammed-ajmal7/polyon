import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Conversation, AgentMessageType } from "@polyon/contracts";
import { describe, expect, it } from "vitest";

import { AgentMessageService } from "./agent-message-service";
import { FileDomainStores, InMemoryDomainStores } from "@polyon/storage";

const conversation: Conversation = {
  id: "conversation.agent-message",
  kind: "COLLABORATIVE",
  status: "ACTIVE",
  participantIds: ["user", "researcher", "analyst"],
  messageIds: [],
  createdAt: "2026-09-29T00:00:00.000Z",
  updatedAt: "2026-09-29T00:00:00.000Z",
};

describe("AgentMessageService", () => {
  it("persists an attributable structured message and traces it", () => {
    const stores = new InMemoryDomainStores();
    stores.conversations.save(conversation);

    const service = new AgentMessageService({
      conversations: stores.conversations,
      messages: stores.messages,
      events: stores.events,
      unitOfWork: stores,
    });

    const message = service.send({
      messageId: "agent-message-1",
      runId: "run-1",
      conversationId: conversation.id,
      fromAgentId: "researcher",
      toAgentId: "analyst",
      agentMessageType: "finding",
      content: "The primary evidence points to a configuration regression.",
      payload: {
        claim: "configuration regression",
        evidenceIds: ["evidence-1"],
        confidence: 0.84,
      },
      participantAgentIds: ["researcher", "analyst"],
      createdAt: "2026-09-29T00:01:00.000Z",
    });

    expect(message).toMatchObject({
      id: "agent-message-1",
      runId: "run-1",
      fromAgentId: "researcher",
      toAgentId: "analyst",
      agentMessageType: "finding",
    });
    expect(service.listByRun("run-1")).toEqual([message]);
    expect(stores.conversations.get(conversation.id)?.messageIds).toEqual(["agent-message-1"]);
    expect(stores.events.list()).toContainEqual(
      expect.objectContaining({
        kind: "AGENT_MESSAGE_CREATED",
        data: expect.objectContaining({
          runId: "run-1",
          fromAgentId: "researcher",
          toAgentId: "analyst",
          agentMessageType: "finding",
        }),
      }),
    );
  });

  it("is idempotent for the same message id", () => {
    const stores = new InMemoryDomainStores();
    stores.conversations.save(conversation);

    const service = new AgentMessageService({
      conversations: stores.conversations,
      messages: stores.messages,
      events: stores.events,
      unitOfWork: stores,
    });

    const input = {
      messageId: "agent-message-idempotent",
      runId: "run-2",
      conversationId: conversation.id,
      fromAgentId: "researcher",
      agentMessageType: "question" as AgentMessageType,
      content: "Can you validate this claim?",
      payload: { claimId: "claim-1" },
      participantAgentIds: ["researcher", "analyst"],
      createdAt: "2026-09-29T00:02:00.000Z",
    };

    const first = service.send(input);
    const second = service.send(input);

    expect(second).toEqual(first);
    expect(stores.messages.list()).toHaveLength(1);
    expect(stores.events.list()).toHaveLength(1);
  });

  it("rejects messages from non-participants", () => {
    const stores = new InMemoryDomainStores();
    stores.conversations.save(conversation);

    const service = new AgentMessageService({
      conversations: stores.conversations,
      messages: stores.messages,
      events: stores.events,
      unitOfWork: stores,
    });

    expect(() =>
      service.send({
        messageId: "agent-message-invalid-source",
        runId: "run-3",
        conversationId: conversation.id,
        fromAgentId: "unknown",
        agentMessageType: "finding",
        content: "Not allowed.",
        payload: {},
        participantAgentIds: ["researcher", "analyst"],
        createdAt: "2026-09-29T00:03:00.000Z",
      }),
    ).toThrow("Source agent is not a participant");
  });

  it("rejects a non-participant target and oversized payloads", () => {
    const stores = new InMemoryDomainStores();
    stores.conversations.save(conversation);

    const service = new AgentMessageService({
      conversations: stores.conversations,
      messages: stores.messages,
      events: stores.events,
      unitOfWork: stores,
    });

    expect(() =>
      service.send({
        messageId: "agent-message-invalid-target",
        runId: "run-4",
        conversationId: conversation.id,
        fromAgentId: "researcher",
        toAgentId: "unknown",
        agentMessageType: "response",
        content: "Not allowed.",
        payload: {},
        participantAgentIds: ["researcher", "analyst"],
        createdAt: "2026-09-29T00:04:00.000Z",
      }),
    ).toThrow("Target agent is not a participant");

    expect(() =>
      service.send({
        messageId: "agent-message-oversized",
        runId: "run-4",
        conversationId: conversation.id,
        fromAgentId: "researcher",
        agentMessageType: "evidence",
        content: "Evidence.",
        payload: { data: "x".repeat(40_000) },
        participantAgentIds: ["researcher", "analyst"],
        createdAt: "2026-09-29T00:04:00.000Z",
      }),
    ).toThrow("payload exceeds");
  });

  it("survives a transaction rollback without leaving a partial message", () => {
    const stores = new InMemoryDomainStores();
    stores.conversations.save(conversation);

    const service = new AgentMessageService({
      conversations: stores.conversations,
      messages: stores.messages,
      events: stores.events,
      unitOfWork: stores,
    });

    expect(() =>
      stores.transaction(() => {
        service.send({
          messageId: "agent-message-rollback",
          runId: "run-5",
          conversationId: conversation.id,
          fromAgentId: "researcher",
          agentMessageType: "decision",
          content: "Temporary.",
          payload: {},
          participantAgentIds: ["researcher", "analyst"],
          createdAt: "2026-09-29T00:05:00.000Z",
        });
        throw new Error("rollback");
      }),
    ).toThrow("rollback");

    expect(service.listByRun("run-5")).toEqual([]);
  });

  it("persists through the same durable store boundary used by POLYON", () => {
    const root = mkdtempSync(join(tmpdir(), "polyon-agent-message-"));

    try {
      const durable = new FileDomainStores(root);
      durable.conversations.save(conversation);
      const service = new AgentMessageService({
        conversations: durable.conversations,
        messages: durable.messages,
        events: durable.events,
        unitOfWork: durable,
      });

      service.send({
        messageId: "agent-message-durable",
        runId: "run-durable",
        conversationId: conversation.id,
        fromAgentId: "researcher",
        agentMessageType: "finding",
        content: "Persist this.",
        payload: { source: "durable-test" },
        participantAgentIds: ["researcher", "analyst"],
        createdAt: "2026-09-29T00:06:00.000Z",
      });

      const reopened = new FileDomainStores(root);
      expect(
        reopened.messages.get("agent-message-durable"),
      ).toMatchObject({
        runId: "run-durable",
        fromAgentId: "researcher",
        agentMessageType: "finding",
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
