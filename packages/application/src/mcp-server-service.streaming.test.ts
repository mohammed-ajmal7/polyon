import { describe, expect, it, vi } from "vitest";

import { McpServerService } from "./mcp-server-service";

const headers = {
  protocolVersion: "2026-07-28",
  method: "tools/call",
  name: "filesystem.read.scoped",
} as const;

function service() {
  const invoke = vi.fn(async () => ({
    status: "SUCCEEDED" as const,
    invocationId: "mcp:1",
    toolId: "filesystem.read.scoped",
    policyDecision: {
      id: "decision-1",
      policyId: "policy",
      action: "READ" as const,
      riskLevel: "LOW" as const,
      effect: "ALLOW" as const,
      reason: "allowed",
      evaluatedAt: "2026-09-29T08:00:00.000Z",
    },
    output: { ok: true },
  }));

  return {
    server: new McpServerService({
      tools: {
        list: () => [
          {
            id: "filesystem.read.scoped",
            name: "Scoped read",
            description: "read",
            kind: "FILESYSTEM" as const,
            actionKinds: ["READ" as const],
            enabled: true,
            inputSchema: { type: "object" as const },
          },
        ],
        get: (id) => (id === "filesystem.read.scoped"
          ? {
              id: "filesystem.read.scoped",
              name: "Scoped read",
              description: "read",
              kind: "FILESYSTEM" as const,
              actionKinds: ["READ" as const],
              enabled: true,
              inputSchema: { type: "object" as const },
            }
          : undefined),
      },
      integrations: { list: () => [], get: () => undefined },
      toolInvocation: { invoke } as never,
      integrationInvocation: { invoke: vi.fn() } as never,
      policy: {
        id: "policy",
        name: "test",
        description: "test",
        approvalMode: "ASK_EVERYTHING" as const,
        rules: [],
        defaultEffect: "REQUIRE_APPROVAL" as const,
        enabled: true,
        createdAt: "2026-09-29T08:00:00.000Z",
        updatedAt: "2026-09-29T08:00:00.000Z",
      },
      actorId: "mcp-client",
    }),
    invoke,
  };
}

async function collect(
  stream: AsyncIterable<Awaited<ReturnType<McpServerService["handle"]>>>,
) {
  const values: Awaited<ReturnType<McpServerService["handle"]>>[] = [];
  for await (const value of stream) values.push(value);
  return values;
}

describe("MCP streamable HTTP", () => {
  it("streams a governed tools/call result without a second invocation", async () => {
    const { server, invoke } = service();

    const values = await collect(
      server.stream(
        {
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: {
            name: "filesystem.read.scoped",
            arguments: {},
          },
        },
        headers,
      ),
    );

    expect(values).toEqual([
      {
        jsonrpc: "2.0",
        id: 1,
        result: {
          content: [{ type: "text", text: JSON.stringify({ ok: true }) }],
        },
      },
    ]);
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("does not turn an MCP notification into an SSE response", async () => {
    const { server } = service();

    const values = await collect(
      server.stream(
        {
          jsonrpc: "2.0",
          id: null,
          method: "notifications/initialized",
        },
        {
          protocolVersion: "2026-07-28",
          method: "notifications/initialized",
        },
      ),
    );

    expect(values).toEqual([]);
  });
});
