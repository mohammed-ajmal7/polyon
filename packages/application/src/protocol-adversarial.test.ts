import { describe, expect, it, vi } from "vitest";

import { McpServerService } from "./mcp-server-service";

describe("protocol adversarial boundaries", () => {
  it("fails closed when MCP routing headers disagree with the body", async () => {
    const service = new McpServerService({
      tools: { list: () => [], get: () => undefined },
      integrations: { list: () => [], get: () => undefined },
      toolInvocation: { invoke: vi.fn() } as never,
      integrationInvocation: { invoke: vi.fn() } as never,
      policy: {
        id: "policy",
        name: "policy",
        description: "policy",
        approvalMode: "ASK_EVERYTHING",
        rules: [],
        defaultEffect: "REQUIRE_APPROVAL",
        enabled: true,
        createdAt: "2026-09-28T00:00:00.000Z",
        updatedAt: "2026-09-28T00:00:00.000Z",
      },
      actorId: "mcp-client",
    });

    const response = await service.handle(
      {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "unknown", arguments: {} },
      },
      {
        protocolVersion: "2026-07-28",
        method: "tools/list",
        name: "unknown",
      },
    );

    expect(response?.error?.code).toBe(-32602);
  });

  it("does not expose unknown MCP tools", async () => {
    const service = new McpServerService({
      tools: { list: () => [], get: () => undefined },
      integrations: { list: () => [], get: () => undefined },
      toolInvocation: { invoke: vi.fn() } as never,
      integrationInvocation: { invoke: vi.fn() } as never,
      policy: {
        id: "policy",
        name: "policy",
        description: "policy",
        approvalMode: "ASK_EVERYTHING",
        rules: [],
        defaultEffect: "REQUIRE_APPROVAL",
        enabled: true,
        createdAt: "2026-09-28T00:00:00.000Z",
        updatedAt: "2026-09-28T00:00:00.000Z",
      },
      actorId: "mcp-client",
    });

    const response = await service.handle(
      {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "shell.exec", arguments: { command: "echo nope" } },
      },
      { protocolVersion: "2026-07-28", method: "tools/call", name: "shell.exec" },
    );

    expect(response?.error?.code).toBe(-32602);
  });
});
