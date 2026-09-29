import type { Execution, Task } from "@polyon/contracts";
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



  it("exposes and manages A2A 1.0 push notification configurations", async () => {
    const push = {
      createConfig: vi.fn(() => ({
        id: "a2a-push:1",
        taskId: "task-new",
        url: "https://client.example.test/a2a/push",
        authentication: { scheme: "Bearer", credentials: "secret" },
      })),
      getConfig: vi.fn(() => ({
        id: "a2a-push:1",
        taskId: "task-new",
        url: "https://client.example.test/a2a/push",
        authentication: { scheme: "Bearer", credentials: "secret" },
      })),
      listConfigs: vi.fn(() => [
        {
          id: "a2a-push:1",
          taskId: "task-new",
          url: "https://client.example.test/a2a/push",
          authentication: { scheme: "Bearer", credentials: "secret" },
        },
      ]),
      deleteConfig: vi.fn(() => true),
    };

    const server = new A2AServerService({
      agents: { list: () => [] },
      commandIngress: { submit: vi.fn() } as never,
      conversationOrchestration: { execute: vi.fn() } as never,
      executions: {
        list: () => [
          {
            id: "execution-new",
            missionId: "mission-1",
            taskId: "task-new",
            actorId: "a2a-client",
            attempt: 1,
            status: "RUNNING" as const,
            createdAt: "2026-09-28T00:00:00.000Z",
            updatedAt: "2026-09-28T00:00:03.000Z",
          },
        ],
      },
      runtime: { cancel: vi.fn() } as never,
      tasks: {
        list: () => [
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
        ],
        get: (id) =>
          id === "task-new"
            ? {
                id: "task-new",
                missionId: "mission-1",
                kind: "RESEARCH" as const,
                title: "New",
                description: "New",
                status: "RUNNING" as const,
                dependsOn: [],
                createdAt: "2026-09-28T00:00:00.000Z",
                updatedAt: "2026-09-28T00:00:03.000Z",
              }
            : undefined,
      },
      policy: policy(),
      actorId: "a2a-client",
      pushNotifications: push as never,
    });

    expect(server.agentCard("http://localhost:3000/api/a2a")).toMatchObject({
      capabilities: { pushNotifications: true },
    });

    const created = await server.handle({
      jsonrpc: "2.0",
      id: "push-create",
      method: "CreateTaskPushNotificationConfig",
      params: {
        taskId: "task-new",
        url: "https://client.example.test/a2a/push",
        authentication: { scheme: "Bearer", credentials: "secret" },
      },
    });

    expect(push.createConfig).toHaveBeenCalledWith({
      taskId: "task-new",
      url: "https://client.example.test/a2a/push",
      authentication: { scheme: "Bearer", credentials: "secret" },
    });
    expect(created?.result).toEqual({
      id: "a2a-push:1",
      taskId: "task-new",
      url: "https://client.example.test/a2a/push",
      authentication: { scheme: "Bearer" },
    });

    const listed = await server.handle({
      jsonrpc: "2.0",
      id: "push-list",
      method: "ListTaskPushNotificationConfigs",
      params: { taskId: "task-new" },
    });
    expect(listed?.result).toEqual({
      configs: [
        {
          id: "a2a-push:1",
          taskId: "task-new",
          url: "https://client.example.test/a2a/push",
          authentication: { scheme: "Bearer" },
        },
      ],
      nextPageToken: "",
    });

    const deleted = await server.handle({
      jsonrpc: "2.0",
      id: "push-delete",
      method: "DeleteTaskPushNotificationConfig",
      params: { taskId: "task-new", id: "a2a-push:1" },
    });
    expect(deleted?.result).toEqual({});
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
      executions: { list: () => [] },
      runtime: { cancel: vi.fn() } as never,
      tasks: {
        list: () => [],
        get: () => undefined,
      },
      policy: policy(),
      actorId: "a2a-client",
    });

    expect(service.agentCard("http://localhost:3000/api/a2a")).toMatchObject({
      protocolVersion: "1.0.0",
      supportedInterfaces: [
        {
          url: "http://localhost:3000/api/a2a",
          protocolBinding: "JSONRPC",
          protocolVersion: "1.0",
        },
      ],
      capabilities: { streaming: true, pushNotifications: false },
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
      message: {
        messageId: "a2a-response",
        contextId: "a2a-req-1",
        role: "ROLE_AGENT",
        parts: [{ text: "world" }],
      },
    });
  });

  it("enforces the A2A 1.0 request header when supplied", async () => {
    const server = new A2AServerService({
      agents: { list: () => [] },
      commandIngress: { submit: vi.fn() } as never,
      conversationOrchestration: { execute: vi.fn() } as never,
      executions: { list: () => [] },
      runtime: { cancel: vi.fn() } as never,
      tasks: { list: () => [], get: () => undefined },
      policy: policy(),
      actorId: "a2a-client",
    });

    const response = await server.handle(
      { jsonrpc: "2.0", id: "version", method: "ListTasks" },
      { version: "0.3" },
    );
    expect(response.error).toEqual({
      code: -32009,
      message: "A2A protocol version 1.0 is required.",
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

  const executions: Execution[] = [
    {
      id: "execution-old",
      missionId: "mission-1",
      taskId: "task-old",
      actorId: "a2a-client",
      attempt: 1,
      status: "SUCCEEDED" as const,
      createdAt: "2026-09-28T00:00:00.000Z",
      updatedAt: "2026-09-28T00:00:01.000Z",
    },
    {
      id: "execution-new",
      missionId: "mission-1",
      taskId: "task-new",
      actorId: "a2a-client",
      attempt: 1,
      status: "RUNNING" as const,
      createdAt: "2026-09-28T00:00:00.000Z",
      updatedAt: "2026-09-28T00:00:03.000Z",
    },
    {
      id: "execution-other",
      missionId: "mission-2",
      taskId: "task-other",
      actorId: "a2a-client",
      attempt: 1,
      status: "FAILED" as const,
      createdAt: "2026-09-28T00:00:00.000Z",
      updatedAt: "2026-09-28T00:00:02.000Z",
    },
  ];

  function service(
    overrides: {
      readonly executions?: typeof executions;
      readonly cancel?: ReturnType<typeof vi.fn>;
    } = {},
  ) {
    const cancel = overrides.cancel ?? vi.fn();
    return new A2AServerService({
      agents: { list: () => [] },
      commandIngress: { submit: vi.fn() } as never,
      conversationOrchestration: { execute: vi.fn() } as never,
      executions: { list: () => overrides.executions ?? executions },
      runtime: { cancel } as never,
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

    const secondResult = second?.result as {
      tasks: readonly {
        id: string;
        status: { state: string };
      }[];
      nextPageToken: string;
      pageSize: number;
      totalSize: number;
    };
    expect(secondResult.pageSize).toBe(2);
    expect(secondResult.totalSize).toBe(3);
    expect(secondResult.nextPageToken).toBe("");
    expect(secondResult.tasks.map((task) => ({ id: task.id, state: task.status.state }))).toEqual([
      { id: "task-old", state: "TASK_STATE_COMPLETED" },
    ]);
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
    const filteredTasks = (
      response?.result as {
        tasks: readonly {
          id: string;
          contextId: string;
          status: { state: string };
        }[];
      }
    ).tasks;
    expect(
      filteredTasks.map((task) => ({
        id: task.id,
        contextId: task.contextId,
        state: task.status.state,
      })),
    ).toEqual([{ id: "task-new", contextId: "mission-1", state: "TASK_STATE_WORKING" }]);
  });

  it("cancels an actor-visible running task through the execution runtime", async () => {
    let currentTask: Task = {
      ...tasks[1],
    };
    const cancel = vi.fn(() => {
      currentTask = {
        ...currentTask,
        status: "CANCELLED" as const,
        updatedAt: "2026-09-28T00:00:04.000Z",
      };
      return {
        status: "CANCELLED" as const,
        execution: {
          ...executions[1],
          status: "CANCELLED" as const,
          updatedAt: "2026-09-28T00:00:04.000Z",
        },
      };
    });
    const server = new A2AServerService({
      agents: { list: () => [] },
      commandIngress: { submit: vi.fn() } as never,
      conversationOrchestration: { execute: vi.fn() } as never,
      executions: {
        list: () => executions,
      },
      runtime: { cancel },
      tasks: {
        list: () => tasks,
        get: (id) => (id === currentTask.id ? currentTask : tasks.find((task) => task.id === id)),
      },
      policy: policy(),
      actorId: "a2a-client",
    });

    const response = await server.handle({
      jsonrpc: "2.0",
      id: 6,
      method: "CancelTask",
      params: { id: "task-new" },
    });

    expect(cancel).toHaveBeenCalledWith("execution-new");
    expect(response?.result).toEqual({
      id: "task-new",
      contextId: "mission-1",
      status: {
        state: "TASK_STATE_CANCELED",
        timestamp: "2026-09-28T00:00:04.000Z",
      },
      metadata: {
        polyonTaskKind: "RESEARCH",
      },
    });
  });

  it("does not expose tasks owned by another actor and rejects non-cancelable tasks", async () => {
    const server = service({
      executions: [
        {
          ...executions[0],
          actorId: "another-actor",
        },
        ...executions.slice(1),
      ],
    });

    const hidden = await server.handle({
      jsonrpc: "2.0",
      id: 7,
      method: "GetTask",
      params: { id: "task-old" },
    });
    expect(hidden?.error).toEqual({
      code: -32001,
      message: "Task not found.",
    });

    const terminal = await server.handle({
      jsonrpc: "2.0",
      id: 8,
      method: "CancelTask",
      params: { id: "task-old" },
    });
    expect(terminal?.error).toEqual({
      code: -32001,
      message: "Task not found.",
    });
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
