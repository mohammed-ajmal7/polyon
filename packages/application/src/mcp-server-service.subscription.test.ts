import { describe, expect, it, vi } from "vitest";

import { InMemoryMcpSubscriptionBus } from "./mcp-subscription-bus";
import { McpServerService } from "./mcp-server-service";

function createServer(bus: InMemoryMcpSubscriptionBus): McpServerService {
  return new McpServerService({
    tools: { list: () => [], get: () => undefined },
    integrations: { list: () => [], get: () => undefined },
    toolInvocation: { invoke: vi.fn() } as never,
    integrationInvocation: { invoke: vi.fn() } as never,
    policy: {
      id: "policy",
      name: "test",
      description: "test",
      approvalMode: "ASK_EVERYTHING",
      rules: [],
      defaultEffect: "REQUIRE_APPROVAL",
      enabled: true,
      createdAt: "2026-09-29T08:00:00.000Z",
      updatedAt: "2026-09-29T08:00:00.000Z",
    },
    actorId: "mcp-client",
    subscriptions: bus,
  });
}

const headers = {
  protocolVersion: "2026-07-28",
  method: "subscriptions/listen",
} as const;

describe("McpServerService subscriptions/listen", () => {
  it("acknowledges the honored filter before streaming matching change notifications", async () => {
    const bus = new InMemoryMcpSubscriptionBus();
    const server = createServer(bus);
    const iterator = server.stream(
      {
        jsonrpc: "2.0",
        id: "listen-1",
        method: "subscriptions/listen",
        params: {
          notifications: {
            toolsListChanged: true,
          },
        },
      },
      headers,
    )[Symbol.asyncIterator]();

    const acknowledgement = await iterator.next();
    expect(acknowledgement).toEqual({
      done: false,
      value: {
        jsonrpc: "2.0",
        method: "notifications/subscriptions/acknowledged",
        params: { notifications: { toolsListChanged: true } },
        _meta: { "io.modelcontextprotocol/subscriptionId": "listen-1" },
      },
    });

    bus.publish({ method: "notifications/resources/list_changed" });
    const pending = iterator.next();
    bus.publish({ method: "notifications/tools/list_changed" });

    const event = await pending;
    expect(event).toEqual({
      done: false,
      value: {
        jsonrpc: "2.0",
        method: "notifications/tools/list_changed",
        _meta: { "io.modelcontextprotocol/subscriptionId": "listen-1" },
      },
    });

    await iterator.return?.();
  });

  it("gracefully closes a bounded subscription when its lifetime expires", async () => {
    const bus = new InMemoryMcpSubscriptionBus();
    const server = new McpServerService({
      tools: { list: () => [], get: () => undefined },
      integrations: { list: () => [], get: () => undefined },
      toolInvocation: { invoke: vi.fn() } as never,
      integrationInvocation: { invoke: vi.fn() } as never,
      policy: {
        id: "policy",
        name: "test",
        description: "test",
        approvalMode: "ASK_EVERYTHING",
        rules: [],
        defaultEffect: "REQUIRE_APPROVAL",
        enabled: true,
        createdAt: "2026-09-29T08:00:00.000Z",
        updatedAt: "2026-09-29T08:00:00.000Z",
      },
      actorId: "mcp-client",
      subscriptions: bus,
    }, {
      subscriptionMaxDurationMs: 1,
      subscriptionWait: async () => undefined,
    });
    const iterator = server.stream(
      {
        jsonrpc: "2.0",
        id: "listen-2",
        method: "subscriptions/listen",
        params: { notifications: { toolsListChanged: true } },
      },
      headers,
    )[Symbol.asyncIterator]();

    await iterator.next();
    const closed = await iterator.next();
    expect(closed.value).toMatchObject({
      jsonrpc: "2.0",
      id: "listen-2",
      result: {},
    });
    expect(closed.done).toBe(false);

    await iterator.return?.();
  });
}
