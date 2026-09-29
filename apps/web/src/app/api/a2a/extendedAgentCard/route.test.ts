import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authenticateRequest: vi.fn<() => Promise<boolean>>(),
}));

vi.mock("@/server/auth", () => ({
  authenticateRequest: mocks.authenticateRequest,
}));

vi.mock("@/server/polyon-server", () => ({
  getPolyonBaseUrl: vi.fn(() => "https://polyon.example"),
  getPolyonComposition: vi.fn(() => ({
    agents: { list: () => [] },
    commandIngress: { submit: vi.fn() },
    conversationOrchestration: { execute: vi.fn() },
    executions: { list: () => [] },
    runtime: { cancel: vi.fn() },
    stores: {
      executions: { list: () => [] },
      tasks: { list: () => [], get: () => undefined },
    },
    a2aPushNotifications: undefined,
  })),
  getPolyonPolicy: vi.fn(() => ({
    id: "test-policy",
    name: "test",
    description: "test",
    approvalMode: "ASK_EVERYTHING",
    rules: [],
    defaultEffect: "REQUIRE_APPROVAL",
    enabled: true,
    createdAt: "2026-09-29T00:00:00.000Z",
    updatedAt: "2026-09-29T00:00:00.000Z",
  })),
}));

import { GET } from "./route";

describe("A2A extended agent card route", () => {
  it("requires authentication", async () => {
    mocks.authenticateRequest.mockResolvedValue(false);

    const response = await GET(new Request("https://polyon.example/api/a2a/extendedAgentCard"));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: "Authentication required.",
    });
  });

  it("returns an authenticated A2A card with the protocol content type", async () => {
    mocks.authenticateRequest.mockResolvedValue(true);

    const response = await GET(new Request("https://polyon.example/api/a2a/extendedAgentCard"));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/a2a+json");

    await expect(response.json()).resolves.toMatchObject({
      name: "POLYON",
      capabilities: {
        extendedAgentCard: true,
      },
      supportedInterfaces: [
        {
          url: "https://polyon.example/api/a2a",
          protocolBinding: "JSONRPC",
          protocolVersion: "1.0",
        },
      ],
    });
  });
});
