import { beforeEach, describe, expect, it, vi } from "vitest";

const { isAuthenticated, getPolyonComposition } = vi.hoisted(() => ({
  isAuthenticated: vi.fn<() => Promise<boolean>>(),
  getPolyonComposition: vi.fn(),
}));

vi.mock("@/server/auth", () => ({
  isAuthenticated,
}));

vi.mock("@/server/polyon-server", () => ({
  getPolyonComposition,
}));

import { GET } from "./route";

beforeEach(() => {
  vi.clearAllMocks();
  isAuthenticated.mockResolvedValue(true);
});

describe("conversation inspection API", () => {
  it("returns a persisted conversation snapshot", async () => {
    const snapshot = {
      conversation: {
        id: "conversation-1",
        kind: "COLLABORATIVE",
        status: "ACTIVE",
        participantIds: ["user-1", "agent-1"],
        messageIds: ["message-1"],
        createdAt: "2026-09-28T00:00:00.000Z",
        updatedAt: "2026-09-28T00:00:01.000Z",
      },
      messages: [
        {
          id: "message-1",
          conversationId: "conversation-1",
          actorId: "agent-1",
          role: "AGENT",
          kind: "TEXT",
          content: "Finding.",
          createdAt: "2026-09-28T00:00:01.000Z",
        },
      ],
      events: [],
    };

    getPolyonComposition.mockReturnValue({
      stores: {
        conversations: { get: vi.fn(() => snapshot.conversation) },
        messages: { get: vi.fn(() => snapshot.messages[0]) },
        events: { listByConversation: vi.fn(() => []) },
      },
    });

    const response = await GET(
      new Request("http://localhost:3000/api/conversations/conversation-1"),
      {
        params: Promise.resolve({ conversationId: "conversation-1" }),
      },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(snapshot);
  });

  it("returns 404 when the conversation does not exist", async () => {
    getPolyonComposition.mockReturnValue({
      stores: {
        conversations: { get: vi.fn(() => undefined) },
        messages: { get: vi.fn() },
        events: { listByConversation: vi.fn() },
      },
    });

    const response = await GET(
      new Request("http://localhost:3000/api/conversations/missing"),
      {
        params: Promise.resolve({ conversationId: "missing" }),
      },
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: "Conversation not found.",
    });
  });

  it("requires authentication", async () => {
    isAuthenticated.mockResolvedValue(false);

    const response = await GET(
      new Request("http://localhost:3000/api/conversations/conversation-1"),
      {
        params: Promise.resolve({ conversationId: "conversation-1" }),
      },
    );

    expect(response.status).toBe(401);
  });
});
