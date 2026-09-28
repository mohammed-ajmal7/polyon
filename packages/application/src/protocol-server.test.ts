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

    expect(response.result).toMatchObject({
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
      policyDecision: { id: "d", policyId: "p", action: "READ", riskLevel: "LOW", effect: "ALLOW", reason: "ok", evaluatedAt: "2026-09-28T00:00:00.000Z" },
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
    expect(mismatch.error?.code).toBe(-32602);

    const response = await service.handle(
      { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: tool.id, arguments: {} } },
      { protocolVersion: "2026-07-28", method: "tools/call", name: tool.id },
    );
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(response.result).toMatchObject({
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
        event: { id: "a2a-event", kind: "MESSAGE_CREATED", occurredAt: "2026-09-28T00:00:00.000Z", data: {} },
      })),
    };
    const conversation = {
      execute: vi.fn(async () => ({
        status: "SUCCEEDED" as const,
        responses: [],
        persistedMessages: [{
          id: "a2a-response",
          conversationId: "a2a-conversation",
          actorId: "agent-1",
          role: "AGENT" as const,
          kind: "TEXT" as const,
          content: "world",
          createdAt: "2026-09-28T00:00:01.000Z",
        }],
      })),
    };
    const service = new A2AServerService({
      agents: {
        list: () => [{ id: "agent-1", name: "Primary", role: "General", status: "ACTIVE", description: "Primary agent" }],
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
    expect(response.result).toEqual({
      role: "agent",
      parts: [{ kind: "text", text: "world" }],
    });
  });
});


describe("A2A task status", () => {
  it("returns bounded persisted task status and maps terminal states", async () => {
    const task = {
      id: "task-1",
      missionId: "mission-1",
      kind: "CODING" as const,
      title: "Build",
      description: "Build it",
      status: "SUCCEEDED" as const,
      dependsOn: [],
      createdAt: "2026-09-28T00:00:00.000Z",
      updatedAt: "2026-09-28T00:00:01.000Z",
    };

    const service = new A2AServerService({
      agents: { list: () => [] },
      commandIngress: { submit: vi.fn() } as never,
      conversationOrchestration: { execute: vi.fn() } as never,
      tasks: {
        list: () => [task],
        get: (id) => (id === task.id ? task : undefined),
      },
      policy: policy(),
      actorId: "a2a-client",
    });

    const getResponse = await service.handle({
      jsonrpc: "2.0",
      id: 1,
      method: "GetTask",
      params: { id: "task-1" },
    });
    expect(getResponse.result).toEqual({
      id: "task-1",
      contextId: "mission-1",
      status: {
        state: "completed",
        timestamp: "2026-09-28T00:00:01.000Z",
      },
      metadata: {
        polyonTaskKind: "CODING",
      },
    });

    const listResponse = await service.handle({
      jsonrpc: "2.0",
      id: 2,
      method: "ListTasks",
      params: { limit: 1 },
    });
    expect(listResponse.result).toMatchObject({
      tasks: [
        expect.objectContaining({
          id: "task-1",
          status: { state: "completed" },
        }),
      ],
    });
  });
});
