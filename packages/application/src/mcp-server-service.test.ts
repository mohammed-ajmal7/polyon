import { InMemoryDomainStores } from "@polyon/storage";
import { InMemoryToolAdapterRegistry, InMemoryToolRegistry } from "@polyon/tools";
import { describe, expect, it, vi } from "vitest";

import { McpServerService } from "./mcp-server-service";
import { ToolInvocationService } from "./tool-invocation-service";

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

    const firstResult = first?.result as {
      tools: readonly { name: string }[];
      nextCursor?: string;
    };

    expect(firstResult.tools).toHaveLength(50);
    expect(firstResult.tools[0]?.name).toBe("tool-0");
    expect(firstResult.tools[49]?.name).toBe("tool-49");
    expect(firstResult.nextCursor).toMatch(/^mcp-tools:/u);

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

describe("MCP tools/call identity", () => {
  const readTool = {
    id: "tool.read",
    name: "Read",
    description: "read",
    kind: "OTHER" as const,
    actionKinds: ["READ" as const],
    enabled: true,
  };
  const headers = { protocolVersion: "2026-07-28", method: "tools/call", name: readTool.id };
  const call = {
    jsonrpc: "2.0" as const,
    id: 1,
    method: "tools/call",
    params: { name: readTool.id, arguments: {} },
  };

  function session(toolInvocation: ToolInvocationService): McpServerService {
    return new McpServerService({
      tools: { list: () => [readTool], get: (id) => (id === readTool.id ? readTool : undefined) },
      integrations: { list: () => [], get: () => undefined },
      toolInvocation,
      integrationInvocation: { invoke: vi.fn() } as never,
      policy: { ...policy, defaultEffect: "ALLOW" },
      actorId: "mcp-client",
    });
  }

  it("does not collide when separate sessions reuse the same JSON-RPC request id", async () => {
    const stores = new InMemoryDomainStores();
    const tools = new InMemoryToolRegistry();
    const adapters = new InMemoryToolAdapterRegistry();
    tools.register(readTool);
    adapters.register({ toolId: readTool.id, invoke: async () => ({ output: { ok: true } }) });
    const toolInvocation = new ToolInvocationService({
      tools,
      adapters,
      approvals: stores.approvals,
      policyDecisions: stores.policyDecisions,
      events: stores.events,
      unitOfWork: stores,
    });

    const first = await session(toolInvocation).handle(call, headers);
    const second = await session(toolInvocation).handle(call, headers);

    expect(first).toMatchObject({ id: 1, result: { content: [{ text: '{"ok":true}' }] } });
    expect(second).toMatchObject({ id: 1, result: { content: [{ text: '{"ok":true}' }] } });
  });

  it("returns invocation service errors as JSON-RPC errors", async () => {
    const toolInvocation = {
      invoke: vi.fn(async () => {
        throw new Error("Tool invocation already has a trace: mcp:1.");
      }),
    } as unknown as ToolInvocationService;

    const response = await session(toolInvocation).handle(call, headers);

    expect(response).toMatchObject({ jsonrpc: "2.0", id: 1, error: { code: -32603 } });
  });
});
