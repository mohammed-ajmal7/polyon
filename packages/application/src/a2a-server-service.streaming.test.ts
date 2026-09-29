import { describe, expect, it, vi } from "vitest";

import type { Execution, Task } from "@polyon/contracts";

import { A2AServerService, type A2AServerDependencies } from "./a2a-server-service";

const now = "2026-09-29T08:00:00.000Z";

function task(status: Task["status"] = "RUNNING", updatedAt = now): Task {
  return {
    id: "task-1",
    missionId: "mission-1",
    kind: "RESEARCH",
    title: "Research",
    description: "Research task",
    status,
    dependsOn: [],
    createdAt: now,
    updatedAt,
  };
}

function execution(): Execution {
  return {
    id: "execution-1",
    taskId: "task-1",
    missionId: "mission-1",
    actorId: "a2a-client",
    status: "RUNNING",
    attempt: 1,
    createdAt: now,
    updatedAt: now,
  };
}

function dependencies(tasks: { current: Task }): A2AServerDependencies {
  return {
    agents: {
      list: () => [
        {
          id: "agent-1",
          name: "Agent 1",
          role: "Researcher",
          status: "ACTIVE",
          description: "Research agent",
        },
      ],
    },
    commandIngress: { submit: vi.fn(() => ({}) as never) } as never,
    conversationOrchestration: {
      execute: vi.fn(async () => ({
        status: "SUCCEEDED" as const,
        persistedMessages: [{ id: "message-1", content: "A2A result" }],
      })),
    } as never,
    executions: { list: () => [execution()] },
    runtime: {
      cancel: vi.fn(() => ({
        status: "CANCELLED" as const,
        execution: execution(),
      })),
    },
    tasks: {
      list: () => [tasks.current],
      get: () => tasks.current,
    },
    policy: {
      id: "policy",
      name: "test",
      description: "test",
      approvalMode: "ASK_EVERYTHING",
      rules: [],
      defaultEffect: "REQUIRE_APPROVAL",
      enabled: true,
      createdAt: now,
      updatedAt: now,
    },
    actorId: "a2a-client",
  };
}

async function collect(
  stream: AsyncIterable<Awaited<ReturnType<A2AServerService["handle"]>>>,
): Promise<readonly Awaited<ReturnType<A2AServerService["handle"]>>[]> {
  const values: Awaited<ReturnType<A2AServerService["handle"]>>[] = [];
  for await (const value of stream) values.push(value);
  return values;
}

describe("A2A streaming", () => {
  it("advertises A2A 1.0 JSON-RPC streaming capability", () => {
    const service = new A2AServerService(dependencies({ current: task() }));
    const card = service.agentCard("https://polyon.example");

    expect(card).toMatchObject({
      supportedInterfaces: [
        {
          url: "https://polyon.example/api/a2a",
          protocolBinding: "JSONRPC",
          protocolVersion: "1.0",
        },
      ],
      capabilities: {
        streaming: true,
        pushNotifications: false,
      },
    });
  });

  it("streams a direct SendStreamingMessage result as a single v1 message event", async () => {
    const service = new A2AServerService(dependencies({ current: task() }));

    const values = await collect(
      service.stream(
        {
          jsonrpc: "2.0",
          id: 1,
          method: "SendStreamingMessage",
          params: { message: { parts: [{ text: "Hello POLYON" }] } },
        },
        { version: "1.0" },
      ),
    );

    expect(values).toHaveLength(1);
    expect(values[0]).toEqual({
      jsonrpc: "2.0",
      id: 1,
      result: {
        message: {
          messageId: "message-1",
          role: "ROLE_AGENT",
          parts: [{ text: "A2A result" }],
        },
      },
    });
  });

  it("subscribes to an active task and closes after a terminal status update", async () => {
    const state = { current: task("RUNNING", now) };
    let waits = 0;

    const service = new A2AServerService(dependencies(state), {
      streamPollIntervalMs: 0,
      streamMaxDurationMs: 10_000,
      wait: async () => {
        waits += 1;
        state.current = task("SUCCEEDED", "2026-09-29T08:00:01.000Z");
      },
      now: () => waits,
    });

    const values = await collect(
      service.stream(
        {
          jsonrpc: "2.0",
          id: "subscribe-1",
          method: "SubscribeToTask",
          params: { id: "task-1" },
        },
        { version: "1.0" },
      ),
    );

    expect(values).toHaveLength(2);
    expect(values[0]?.result).toEqual({
      task: {
        id: "task-1",
        contextId: "mission-1",
        status: { state: "TASK_STATE_WORKING", timestamp: now },
        metadata: { polyonTaskKind: "RESEARCH" },
      },
    });
    expect(values[1]?.result).toEqual({
      statusUpdate: {
        taskId: "task-1",
        contextId: "mission-1",
        status: {
          state: "TASK_STATE_COMPLETED",
          timestamp: "2026-09-29T08:00:01.000Z",
        },
      },
    });
    expect(waits).toBe(1);
  });

  it("rejects terminal task subscriptions and unsupported protocol versions", async () => {
    const service = new A2AServerService(dependencies({ current: task("SUCCEEDED") }));

    const terminal = await collect(
      service.stream(
        {
          jsonrpc: "2.0",
          id: 2,
          method: "SubscribeToTask",
          params: { id: "task-1" },
        },
        { version: "1.0" },
      ),
    );
    expect(terminal[0]?.error).toEqual({
      code: -32004,
      message: "Task subscription is not supported for terminal tasks.",
    });

    const version = await service.handle(
      {
        jsonrpc: "2.0",
        id: 3,
        method: "GetTask",
        params: { id: "task-1" },
      },
      { version: "0.3" },
    );
    expect(version.error).toEqual({
      code: -32009,
      message: "A2A protocol version 1.0 is required.",
    });
  });
});
