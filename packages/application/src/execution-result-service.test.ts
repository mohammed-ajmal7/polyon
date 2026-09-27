import type { Conversation, Execution } from "@polyon/contracts";
import { InMemoryDomainStores, InMemoryEventStore } from "@polyon/storage";
import { describe, expect, it } from "vitest";

import {
  ExecutionResultService,
  ExecutionResultServiceError,
} from "./execution-result-service";

const execution: Execution = {
  id: "execution-1",
  missionId: "mission-1",
  taskId: "task-1",
  actorId: "agent-1",
  attempt: 1,
  status: "SUCCEEDED",
  startedAt: "2026-09-27T03:00:00.000Z",
  completedAt: "2026-09-27T03:05:00.000Z",
  createdAt: "2026-09-27T02:30:00.000Z",
  updatedAt: "2026-09-27T03:05:00.000Z",
};

const conversation: Conversation = {
  id: "conversation-1",
  kind: "MISSION",
  status: "ACTIVE",
  participantIds: ["user-1", "agent-1"],
  messageIds: ["message-1"],
  missionId: "mission-1",
  createdAt: "2026-09-27T02:00:00.000Z",
  updatedAt: "2026-09-27T02:30:00.000Z",
};

function createService() {
  const stores = new InMemoryDomainStores();
  const events = new InMemoryEventStore();

  stores.executions.save(execution);
  stores.conversations.save(conversation);

  return {
    stores,
    events,
    service: new ExecutionResultService({
      executions: stores.executions,
      conversations: stores.conversations,
      messages: stores.messages,
      artifacts: stores.artifacts,
      events,
    }),
  };
}

const baseInput = {
  executionId: "execution-1",
  conversationId: "conversation-1",
  messageId: "message-2",
  actorId: "agent-1",
  output: "Execution completed successfully.",
  createdAt: "2026-09-27T03:06:00.000Z",
};

describe("ExecutionResultService", () => {
  it("runs result publication through the supplied unit of work", () => {
    const stores = new InMemoryDomainStores();

    stores.executions.save(execution);
    stores.conversations.save(conversation);

    let transactionCalls = 0;
    const unitOfWork = {
      transaction<T>(
        work: Parameters<InMemoryDomainStores["transaction"]>[0],
      ): T {
        transactionCalls += 1;
        return stores.transaction(work) as T;
      },
    };

    const service = new ExecutionResultService({
      executions: stores.executions,
      conversations: stores.conversations,
      messages: stores.messages,
      artifacts: stores.artifacts,
      events: stores.events,
      unitOfWork,
    });

    const result = service.persist({
      ...baseInput,
      artifacts: [
        {
          id: "artifact-transaction-1",
          kind: "REPORT",
          name: "transaction-report.md",
          location: "local://transaction-report.md",
          createdAt: "2026-09-27T03:06:00.000Z",
        },
      ],
    });

    expect(transactionCalls).toBe(1);
    expect(stores.messages.get("message-2")).toEqual(result.message);
    expect(stores.artifacts.get("artifact-transaction-1")).toEqual(
      result.artifacts[0],
    );
    expect(stores.conversations.get("conversation-1")).toEqual(
      result.conversation,
    );
    expect(stores.events.list().map((event) => event.kind)).toEqual([
      "MESSAGE_CREATED",
      "ARTIFACT_CREATED",
    ]);
  });

  it("persists the result message, artifacts, conversation update, and trace events", () => {
    const { stores, events, service } = createService();

    const result = service.persist({
      ...baseInput,
      artifacts: [
        {
          id: "artifact-1",
          kind: "REPORT",
          name: "execution-report.md",
          mimeType: "text/markdown",
          location: "local://reports/execution-1.md",
          createdAt: "2026-09-27T03:06:00.000Z",
        },
      ],
    });

    expect(result.message).toEqual({
      id: "message-2",
      conversationId: "conversation-1",
      actorId: "agent-1",
      role: "AGENT",
      kind: "TEXT",
      content: "Execution completed successfully.",
      createdAt: "2026-09-27T03:06:00.000Z",
    });
    expect(result.artifacts).toEqual([
      {
        id: "artifact-1",
        kind: "REPORT",
        name: "execution-report.md",
        mimeType: "text/markdown",
        location: "local://reports/execution-1.md",
        status: "AVAILABLE",
        missionId: "mission-1",
        taskId: "task-1",
        executionId: "execution-1",
        createdAt: "2026-09-27T03:06:00.000Z",
        updatedAt: "2026-09-27T03:06:00.000Z",
      },
    ]);
    expect(result.conversation.messageIds).toEqual(["message-1", "message-2"]);
    expect(stores.messages.get("message-2")).toEqual(result.message);
    expect(stores.artifacts.get("artifact-1")).toEqual(result.artifacts[0]);
    expect(stores.conversations.get("conversation-1")).toEqual(result.conversation);
    expect(events.list().map((event) => event.kind)).toEqual([
      "MESSAGE_CREATED",
      "ARTIFACT_CREATED",
    ]);
    expect(events.listByExecution("execution-1").map((event) => event.kind)).toEqual([
      "MESSAGE_CREATED",
      "ARTIFACT_CREATED",
    ]);
    expect(events.listByConversation("conversation-1").map((event) => event.kind)).toEqual([
      "MESSAGE_CREATED",
      "ARTIFACT_CREATED",
    ]);
  });

  it("publishes a failed execution as a system error message", () => {
    const { stores, service } = createService();
    stores.executions.save({
      ...execution,
      status: "FAILED",
      error: "Provider unavailable.",
    });

    const result = service.persist({
      ...baseInput,
      messageId: "message-error-1",
      output: "Provider unavailable.",
    });

    expect(result.message.role).toBe("SYSTEM");
    expect(result.message.kind).toBe("ERROR");
    expect(stores.messages.get("message-error-1")?.kind).toBe("ERROR");
  });

  it("rejects a non-terminal execution before any write", () => {
    const { stores, events, service } = createService();
    stores.executions.save({
      ...execution,
      status: "RUNNING",
    });

    expect(() =>
      service.persist({
        ...baseInput,
        messageId: "message-running-1",
      }),
    ).toThrowError(
      new ExecutionResultServiceError(
        "EXECUTION_NOT_TERMINAL",
        "Cannot persist a result while execution execution-1 is RUNNING.",
      ),
    );

    expect(stores.messages.get("message-running-1")).toBeUndefined();
    expect(events.list()).toEqual([]);
  });

  it("rejects a non-mission conversation", () => {
    const { stores, events, service } = createService();
    stores.conversations.save({
      ...conversation,
      kind: "DIRECT",
    });

    expect(() =>
      service.persist({
        ...baseInput,
        messageId: "message-kind-1",
      }),
    ).toThrowError(MissionResultErrorMatcher("CONVERSATION_KIND_MISMATCH"));

    expect(stores.messages.get("message-kind-1")).toBeUndefined();
    expect(events.list()).toEqual([]);
  });

  it("rejects a conversation bound to another mission", () => {
    const { stores, service } = createService();
    stores.conversations.save({
      ...conversation,
      missionId: "mission-2",
    });

    expect(() =>
      service.persist({
        ...baseInput,
        messageId: "message-mismatch-1",
      }),
    ).toThrowError(MissionResultErrorMatcher("CONVERSATION_MISSION_MISMATCH"));
  });

  it("rejects a result actor outside the conversation", () => {
    const { stores, service } = createService();
    expect(() =>
      service.persist({
        ...baseInput,
        actorId: "agent-2",
        messageId: "message-actor-1",
      }),
    ).toThrowError(MissionResultErrorMatcher("ACTOR_NOT_PARTICIPANT"));
  });

  it("rejects duplicate message IDs before writing artifacts", () => {
    const { stores, events, service } = createService();
    stores.messages.save({
      id: "message-2",
      conversationId: "conversation-1",
      actorId: "agent-1",
      role: "AGENT",
      kind: "TEXT",
      content: "Existing.",
      createdAt: "2026-09-27T03:06:00.000Z",
    });

    expect(() =>
      service.persist({
        ...baseInput,
        artifacts: [
          {
            id: "artifact-1",
            kind: "REPORT",
            name: "report.md",
            location: "local://report.md",
            createdAt: "2026-09-27T03:06:00.000Z",
          },
        ],
      }),
    ).toThrowError(MissionResultErrorMatcher("MESSAGE_EXISTS"));

    expect(stores.artifacts.get("artifact-1")).toBeUndefined();
    expect(events.list()).toEqual([]);
  });

  it("rejects a duplicate existing artifact before writing the message", () => {
    const { stores, events, service } = createService();
    stores.artifacts.save({
      id: "artifact-1",
      kind: "REPORT",
      name: "existing.md",
      location: "local://existing.md",
      status: "AVAILABLE",
      missionId: "mission-1",
      taskId: "task-1",
      executionId: "execution-1",
      createdAt: "2026-09-27T03:00:00.000Z",
      updatedAt: "2026-09-27T03:00:00.000Z",
    });

    expect(() =>
      service.persist({
        ...baseInput,
        artifacts: [
          {
            id: "artifact-1",
            kind: "REPORT",
            name: "new.md",
            location: "local://new.md",
            createdAt: "2026-09-27T03:06:00.000Z",
          },
        ],
      }),
    ).toThrowError(MissionResultErrorMatcher("ARTIFACT_EXISTS"));

    expect(stores.messages.get("message-2")).toBeUndefined();
    expect(events.list()).toEqual([]);
  });

  it("rejects duplicate artifact IDs within the same result", () => {
    const { stores, events, service } = createService();

    expect(() =>
      service.persist({
        ...baseInput,
        artifacts: [
          {
            id: "artifact-1",
            kind: "REPORT",
            name: "first.md",
            location: "local://first.md",
            createdAt: "2026-09-27T03:06:00.000Z",
          },
          {
            id: "artifact-1",
            kind: "REPORT",
            name: "second.md",
            location: "local://second.md",
            createdAt: "2026-09-27T03:06:00.000Z",
          },
        ],
      }),
    ).toThrowError(MissionResultErrorMatcher("DUPLICATE_ARTIFACT_ID"));

    expect(stores.messages.get("message-2")).toBeUndefined();
    expect(stores.artifacts.list()).toEqual([]);
    expect(events.list()).toEqual([]);
  });

  it("rejects a missing conversation before writing the message", () => {
    const { stores, events, service } = createService();

    expect(() =>
      service.persist({
        ...baseInput,
        conversationId: "missing-conversation",
        messageId: "message-missing-conversation",
      }),
    ).toThrowError(MissionResultErrorMatcher("CONVERSATION_NOT_FOUND"));

    expect(stores.messages.get("message-missing-conversation")).toBeUndefined();
    expect(events.list()).toEqual([]);
  });

  it("rejects results for inactive conversations", () => {
    const { stores, events, service } = createService();
    stores.conversations.save({
      ...conversation,
      status: "COMPLETED",
    });

    expect(() =>
      service.persist({
        ...baseInput,
        messageId: "message-inactive",
      }),
    ).toThrowError(MissionResultErrorMatcher("CONVERSATION_NOT_ACTIVE"));

    expect(stores.messages.get("message-inactive")).toBeUndefined();
    expect(events.list()).toEqual([]);
  });
});

function MissionResultErrorMatcher(
  kind:
    | "CONVERSATION_KIND_MISMATCH"
    | "CONVERSATION_MISSION_MISMATCH"
    | "ACTOR_NOT_PARTICIPANT"
    | "MESSAGE_EXISTS"
    | "ARTIFACT_EXISTS"
    | "DUPLICATE_ARTIFACT_ID"
    | "CONVERSATION_NOT_FOUND"
    | "CONVERSATION_NOT_ACTIVE",
) {
  return expect.objectContaining({
    name: "ExecutionResultServiceError",
    kind,
  });
}
