import { describe, expect, it, vi } from "vitest";

import { A2AServerService } from "./a2a-server-service";
import { McpServerService } from "./mcp-server-service";

function policy() {
  return {
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
}

describe("protocol servers", () => {
  it("negotiates MCP 2026-07-28 and lists enabled tools", async () => {
    const service = new McpServerService({
      tools: {
        list: () => [
          {
            id: "filesystem.read.scoped",
            name: "Scoped read",
            description: "read",
            kind: "FILESYSTEM",
            actionKinds: ["READ"],
            enabled: true,
          },
        ],
        get: () => undefined,
      },
      integrations: { list: () => [], get: () => undefined },
      toolInvocation: { invoke: vi.fn() } as never,
      integrationInvocation: { invoke: vi.fn() } as never,
      policy: policy(),
      actorId: "mcp-client",
    });

    const response = await service.handle(
      { jsonrpc: "2.0", id: 1, method: "tools/list" },
      { protocolVersion: "2026-07-28", method: "tools/list" },
    );

    expect(response?.result).toMatchObject({
      tools: [{ name: "filesystem.read.scoped" }],
      ttlMs: 10_000,
      cacheScope: "private",
    });
  });

  it("rejects MCP header mismatches and executes governed tools", async () => {
    const invoke = vi.fn(async () => ({
      status: "SUCCEEDED" as const,
      invocationId: "mcp:2",
      toolId: "filesystem.read.scoped",
      policyDecision: {
        id: "d",
        policyId: "p",
        action: "READ",
        riskLevel: "LOW",
        effect: "ALLOW",
        reason: "ok",
        evaluatedAt: "2026-09-28T00:00:00.000Z",
      },
      output: { ok: true },
    }));
    const tool = {
      id: "filesystem.read.scoped",
      name: "Read",
      description: "read",
      kind: "FILESYSTEM" as const,
      actionKinds: ["READ" as const],
      enabled: true,
      inputSchema: { type: "object" as const, additionalProperties: true },
    };
    const service = new McpServerService({
      tools: { list: () => [tool], get: (id) => (id === tool.id ? tool : undefined) },
      integrations: { list: () => [], get: () => undefined },
      toolInvocation: { invoke } as never,
      integrationInvocation: { invoke: vi.fn() } as never,
      policy: policy(),
      actorId: "mcp-client",
    });

    const mismatch = await service.handle(
      { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: tool.id, arguments: {} } },
      { protocolVersion: "2026-07-28", method: "tools/list", name: tool.id },
    );
    expect(mismatch?.error?.code).toBe(-32602);

    const response = await service.handle(
      { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: tool.id, arguments: {} } },
      { protocolVersion: "2026-07-28", method: "tools/call", name: tool.id },
    );
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(response?.result).toMatchObject({
      content: [{ type: "text", text: JSON.stringify({ ok: true }) }],
    });
  });

  it("exposes an A2A 1.0 agent card and routes SendMessage to governed direct execution", async () => {
    const commandIngress = {
      submit: vi.fn(() => ({
        conversation: {
          id: "a2a-conversation",
          kind: "DIRECT",
          status: "ACTIVE",
          participantIds: ["a2a-client", "agent-1"],
          messageIds: ["a2a-message"],
          createdAt: "2026-09-28T00:00:00.000Z",
          updatedAt: "2026-09-28T00:00:00.000Z",
        },
        message: {
          id: "a2a-message",
          conversationId: "a2a-conversation",
          actorId: "a2a-client",
          role: "USER",
          kind: "TEXT",
          content: "hello",
          createdAt: "2026-09-28T00:00:00.000Z",
        },
        event: {
          id: "a2a-event",
          kind: "MESSAGE_CREATED",
          occurredAt: "2026-09-28T00:00:00.000Z",
          data: {},
        },
      })),
    };
    const conversation = {
      execute: vi.fn(async () => ({
        status: "SUCCEEDED" as const,
        responses: [],
        persistedMessages: [
          {
            id: "a2a-response",
            conversationId: "a2a-conversation",
            actorId: "agent-1",
            role: "AGENT" as const,
            kind: "TEXT" as const,
            content: "world",
            createdAt: "2026-09-28T00:00:01.000Z",
          },
        ],
      })),
    };
    const service = new A2AServerService({
      agents: {
        list: () => [
          {
            id: "agent-1",
            name: "Primary",
            role: "General",
            status: "ACTIVE",
            description: "Primary agent",
          },
        ],
      },
      commandIngress: commandIngress as never,
      conversationOrchestration: conversation as never,
      tasks: {
        list: () => [],
        get: () => undefined,
      },
      policy: policy(),
      actorId: "a2a-client",
    });

    expect(service.agentCard("http://localhost:3000/api/a2a")).toMatchObject({
      protocolVersion: "1.0.0",
      capabilities: { streaming: false },
      defaultInputModes: ["text/plain"],
    });

    const response = await service.handle({
      jsonrpc: "2.0",
      id: "req-1",
      method: "SendMessage",
      params: {
        message: {
          role: "user",
          parts: [{ kind: "text", text: "hello" }],
        },
      },
    });

    expect(conversation.execute).toHaveBeenCalledTimes(1);
    expect(response?.result).toEqual({
      role: "agent",
      parts: [{ kind: "text", text: "world" }],
    });
  });
});

describe("A2A task listing", () => {
  const tasks = [
    {
      id: "task-old",
      missionId: "mission-1",
      kind: "CODING" as const,
      title: "Old",
      description: "Old",
      status: "SUCCEEDED" as const,
      dependsOn: [],
      createdAt: "2026-09-28T00:00:00.000Z",
      updatedAt: "2026-09-28T00:00:01.000Z",
    },
    {
      id: "task-new",
      missionId: "mission-1",
      kind: "RESEARCH" as const,
      title: "New",
      description: "New",
      status: "RUNNING" as const,
      dependsOn: [],
      createdAt: "2026-09-28T00:00:00.000Z",
      updatedAt: "2026-09-28T00:00:03.000Z",
    },
    {
      id: "task-other",
      missionId: "mission-2",
      kind: "ANALYSIS" as const,
      title: "Other",
      description: "Other",
      status: "FAILED" as const,
      dependsOn: [],
      createdAt: "2026-09-28T00:00:00.000Z",
      updatedAt: "2026-09-28T00:00:02.000Z",
    },
  ];

  function service() {
    return new A2AServerService({
      agents: { list: () => [] },
      commandIngress: { submit: vi.fn() } as never,
      conversationOrchestration: { execute: vi.fn() } as never,
      tasks: {
        list: () => tasks,
        get: (id) => tasks.find((task) => task.id === id),
      },
      policy: policy(),
      actorId: "a2a-client",
    });
  }

  it("returns A2A 1.0 cursor-paginated task pages in newest-first order", async () => {
    const server = service();

    const first = await server.handle({
      jsonrpc: "2.0",
      id: 1,
      method: "ListTasks",
      params: { pageSize: 2 },
    });

    const firstResult = first?.result as {
      tasks: readonly {
        id: string;
        status: { state: string };
      }[];
      nextPageToken: string;
      pageSize: number;
      totalSize: number;
    };
    expect(firstResult.pageSize).toBe(2);
    expect(firstResult.totalSize).toBe(3);
    expect(firstResult.tasks.map((task) => ({ id: task.id, state: task.status.state }))).toEqual([
      { id: "task-new", state: "TASK_STATE_WORKING" },
      { id: "task-other", state: "TASK_STATE_FAILED" },
    ]);
    expect(firstResult.nextPageToken).toMatch(/^a2a-tasks:/u);

    const second = await server.handle({
      jsonrpc: "2.0",
      id: 2,
      method: "ListTasks",
      params: { pageSize: 2, pageToken: firstResult.nextPageToken },
    });

    expect(second?.result).toMatchObject({
      pageSize: 2,
      totalSize: 3,
      nextPageToken: "",
      tasks: [
        expect.objectContaining({
          id: "task-old",
          status: { state: "TASK_STATE_COMPLETED" },
        }),
      ],
    });
  });

  it("filters tasks by context and status", async () => {
    const response = await service().handle({
      jsonrpc: "2.0",
      id: 3,
      method: "ListTasks",
      params: {
        contextId: "mission-1",
        status: "TASK_STATE_WORKING",
      },
    });

    expect(response?.result).toMatchObject({
      nextPageToken: "",
      pageSize: 50,
      totalSize: 1,
    });
    expect(
      ((response?.result as { tasks: readonly { id: string; contextId: string; status: { state: string } }[] }).tasks)
        .map((task) => ({ id: task.id, contextId: task.contextId, state: task.status.state })),
    ).toEqual([{ id: "task-new", contextId: "mission-1", state: "TASK_STATE_WORKING" }]);
  });

  it("rejects invalid pagination parameters and tokens", async () => {
    const invalidSize = await service().handle({
      jsonrpc: "2.0",
      id: 4,
      method: "ListTasks",
      params: { pageSize: 101 },
    });
    expect(invalidSize?.error).toEqual({
      code: -32602,
      message: "pageSize must be between 1 and 100.",
    });

    const invalidToken = await service().handle({
      jsonrpc: "2.0",
      id: 5,
      method: "ListTasks",
      params: { pageToken: "invalid" },
    });
    expect(invalidToken?.error).toEqual({
      code: -32602,
      message: "A2A task page token is invalid.",
    });
  });
});
