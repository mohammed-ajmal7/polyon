import { describe, expect, it, vi } from "vitest";

const {
  authenticateRequest,
  getPolyonComposition,
  getPolyonPolicy,
  isUntrustedBrowserProtocolRequest,
} = vi.hoisted(() => ({
  authenticateRequest: vi.fn(),
  getPolyonComposition: vi.fn(),
  getPolyonPolicy: vi.fn(),
  isUntrustedBrowserProtocolRequest: vi.fn(() => false),
}));

vi.mock("@/server/auth", () => ({ authenticateRequest }));
vi.mock("@/server/polyon-server", () => ({
  getPolyonComposition,
  getPolyonPolicy,
  isUntrustedBrowserProtocolRequest,
}));

import { POST } from "./route";

describe("MCP HTTP route", () => {
  it("returns 204 for an MCP initialization notification", async () => {
    authenticateRequest.mockResolvedValue(true);
    getPolyonComposition.mockReturnValue({
      tools: { list: () => [], get: () => undefined },
      integrations: { list: () => [], get: () => undefined },
      toolInvocation: { invoke: vi.fn() },
      integrationInvocation: { invoke: vi.fn() },
    });
    getPolyonPolicy.mockReturnValue({
      id: "policy",
      name: "test",
      description: "test",
      approvalMode: "ASK_EVERYTHING",
      rules: [],
      defaultEffect: "REQUIRE_APPROVAL",
      enabled: true,
      createdAt: "2026-09-28T00:00:00.000Z",
      updatedAt: "2026-09-28T00:00:00.000Z",
    });

    const response = await POST(
      new Request("http://localhost:3000/api/mcp", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "MCP-Protocol-Version": "2026-07-28",
          "Mcp-Method": "notifications/initialized",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "notifications/initialized",
        }),
      }),
    );

    expect(response.status).toBe(204);
  });

  it("rejects cookie-authenticated cross-origin browser requests", async () => {
    authenticateRequest.mockResolvedValue(true);
    isUntrustedBrowserProtocolRequest.mockReturnValueOnce(true);

    const response = await POST(
      new Request("http://localhost:3000/api/mcp", {
        method: "POST",
        headers: { "content-type": "text/plain", origin: "http://localhost:5173" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      }),
    );

    expect(response.status).toBe(403);
    expect(getPolyonComposition).not.toHaveBeenCalled();
  });
});
