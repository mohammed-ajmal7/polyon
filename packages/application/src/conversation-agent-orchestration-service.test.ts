import { describe, expect, it, vi } from "vitest";

import { InMemoryDomainStores } from "@polyon/storage";

import { ConversationAgentOrchestrationService } from "./conversation-agent-orchestration-service";

describe("ConversationAgentOrchestrationService", () => {
  it("broadcasts to bounded agent targets and persists successful responses", async () => {
    const stores = new InMemoryDomainStores();
    const orchestration = {
      invoke: vi.fn(async ({ agentId }: { agentId: string }) => ({
        status: "SUCCEEDED" as const,
        response: { content: "response from " + agentId },
        rounds: 0,
      })),
    };

    const conversation = {
      id: "conversation-1",
      kind: "BROADCAST" as const,
      status: "ACTIVE" as const,
      participantIds: ["user-1", "agent-a", "agent-b"],
      messageIds: ["message-1"],
      createdAt: "2026-09-28T00:00:00.000Z",
      updatedAt: "2026-09-28T00:00:00.000Z",
    };
    stores.conversations.save(conversation);
    stores.messages.save({
      id: "message-1",
      conversationId: "conversation-1",
      actorId: "user-1",
      role: "USER",
      kind: "TEXT",
      content: "Compare these approaches.",
      createdAt: "2026-09-28T00:00:00.000Z",
    });

    const service = new ConversationAgentOrchestrationService(
      orchestration as never,
      stores.conversations,
      stores.messages,
      stores.events,
      stores,
    );

    const result = await service.execute({
      command: {
        conversation,
        message: stores.messages.get("message-1")!,
        event: stores.events.get("none") as never,
      },
      targets: [
        { agentId: "agent-a", actorId: "agent-a" },
        { agentId: "agent-b", actorId: "agent-b" },
      ],
      requiredCapabilityIds: [],
      policy: {
        id: "policy",
        name: "test",
        description: "test",
        approvalMode: "BALANCED",
        rules: [],
        defaultEffect: "ALLOW",
        enabled: true,
        createdAt: "2026-09-28T00:00:00.000Z",
        updatedAt: "2026-09-28T00:00:00.000Z",
      },
      actorId: "user-1",
    });

    expect(result.status).toBe("SUCCEEDED");
    expect(orchestration.invoke).toHaveBeenCalledTimes(2);
    expect(result.persistedMessages.map((message) => message.content)).toEqual([
      "response from agent-a",
      "response from agent-b",
    ]);
    expect(stores.messages.list()).toHaveLength(3);
  });
});
