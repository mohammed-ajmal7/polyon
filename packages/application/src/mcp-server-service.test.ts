import { describe, expect, it, vi } from "vitest";

import { McpServerService } from "./mcp-server-service";

const policy = {
  id: "policy",
  name: "test",
  description: "test",
  approvalMode: "ASK_EVERYTHING" as const,
  rules: [],
  defaultEffect: "REQUIRE_APPROVAL" as const,
  enabled: true,
  createdAt: "2026-09-28T00:00:00.000Z",
  updatedAt: "2026-09-28T00:00:00.000Z",
};

function service(toolCount = 0): McpServerService {
  const tools = Array.from({ length: toolCount }, (_, index) => ({
    id: "tool-" + index,
    name: "Tool " + index,
    description: "test",
    kind: "OTHER" as const,
    actionKinds: ["READ" as const],
    enabled: true,
  }));

  return new McpServerService({
    tools: {
      list: () => tools,
      get: () => undefined,
    },
    integrations: { list: () => [], get: () => undefined },
    toolInvocation: { invoke: vi.fn() } as never,
    integrationInvocation: { invoke: vi.fn() } as never,
    policy,
    actorId: "mcp-client",
  });
}

describe("MCP notification and pagination handling", () => {
  it("returns no JSON-RPC response for notifications/initialized", async () => {
    const response = await service().handle(
      { jsonrpc: "2.0", method: "notifications/initialized" },
      { protocolVersion: "2026-07-28", method: "notifications/initialized" },
    );

    expect(response).toBeUndefined();
  });

  it("paginates tools/list with bounded opaque cursors", async () => {
    const server = service(51);

    const first = await server.handle(
      { jsonrpc: "2.0", id: 1, method: "tools/list" },
      { protocolVersion: "2026-07-28", method: "tools/list" },
    );

    expect(first?.result).toMatchObject({
      tools: expect.arrayContaining([{ name: "tool-0" }, { name: "tool-49" }]),
      nextCursor: expect.stringMatching(/^mcp-tools:/u),
    });

    const cursor = (first?.result as { nextCursor: string }).nextCursor;
    const second = await server.handle(
      { jsonrpc: "2.0", id: 2, method: "tools/list", params: { cursor } },
      { protocolVersion: "2026-07-28", method: "tools/list" },
    );

    expect(second?.result).toMatchObject({
      tools: [{ name: "tool-50" }],
    });
  });

  it("rejects malformed pagination cursors", async () => {
    const response = await service().handle(
      {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/list",
        params: { cursor: "invalid" },
      },
      { protocolVersion: "2026-07-28", method: "tools/list" },
    );

    expect(response?.error).toEqual({
      code: -32602,
      message: "MCP tools/list cursor is invalid.",
    });
  });
});
