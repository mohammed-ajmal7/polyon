import { describe, expect, it, vi } from "vitest";

import type { Execution, Task } from "@polyon/contracts";

import { A2AServerService } from "./a2a-server-service";
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
  it("rejects MCP requests with an unsupported protocol version", async () => {
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
        id: 3,
        method: "tools/list",
      },
      { protocolVersion: "2025-06-18", method: "tools/list" },
    );

    expect(response?.error?.code).toBe(-32602);
  });

  it("rejects malformed MCP subscription filters before opening a stream", async () => {
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

    const [frame] = await collect(
      service.stream(
        {
          jsonrpc: "2.0",
          id: "subscription-1",
          method: "subscriptions/listen",
          params: {
            notifications: {
              toolsListChanged: "yes",
            },
          },
        },
        { protocolVersion: "2026-07-28", method: "subscriptions/listen" },
      ),
    );

    expect(frame).toMatchObject({
      jsonrpc: "2.0",
      id: "subscription-1",
      error: { code: -32602 },
    });
  });

  it("fails closed for invalid A2A requests and hidden tasks", async () => {
    const service = new A2AServerService({
      agents: { list: () => [] },
      commandIngress: {} as never,
      conversationOrchestration: {} as never,
      executions: {
        list: () => [
          {
            id: "execution-visible",
            missionId: "mission-1",
            taskId: "task-visible",
            actorId: "actor-other",
            attempt: 1,
            status: "RUNNING",
            createdAt: "2026-09-28T00:00:00.000Z",
            updatedAt: "2026-09-28T00:00:00.000Z",
          } satisfies Execution,
        ],
      },
      runtime: { cancel: vi.fn() } as never,
      tasks: {
        list: () => [
          {
            id: "task-visible",
            missionId: "mission-1",
            kind: "ANALYSIS",
            title: "Visible task",
            description: "A task used to verify visibility boundaries.",
            status: "RUNNING",
            dependsOn: [],
            createdAt: "2026-09-28T00:00:00.000Z",
            updatedAt: "2026-09-28T00:00:00.000Z",
          } satisfies Task,
        ],
        get: () =>
          ({
            id: "task-visible",
            missionId: "mission-1",
            kind: "ANALYSIS",
            title: "Visible task",
            description: "A task used to verify visibility boundaries.",
            status: "RUNNING",
            dependsOn: [],
            createdAt: "2026-09-28T00:00:00.000Z",
            updatedAt: "2026-09-28T00:00:00.000Z",
          }) satisfies Task,
      },
      policy: {} as never,
      actorId: "actor-local",
    });

    const invalid = await service.handle({
      jsonrpc: "1.0",
      id: 4,
      method: "GetTask",
    } as never);
    expect(invalid.error?.code).toBe(-32600);

    const hidden = await service.handle({
      jsonrpc: "2.0",
      id: 5,
      method: "GetTask",
      params: { id: "task-visible" },
    });
    expect(hidden.error?.code).toBe(-32001);
  });
});

function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  return (async () => {
    const values: T[] = [];
    for await (const value of iterable) {
      values.push(value);
      if (values.length >= 1) break;
    }
    return values;
  })();
}
