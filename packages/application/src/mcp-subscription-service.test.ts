import { describe, expect, it } from "vitest";

import type { Tool } from "@polyon/contracts";

import { McpSubscriptionService } from "./mcp-subscription-service";

const tool = (id: string): Tool => ({
  id,
  name: id,
  description: "test",
  kind: "OTHER",
  actionKinds: ["READ"],
  enabled: true,
  inputSchema: { type: "object" },
});

describe("McpSubscriptionService", () => {
  it("acknowledges the honored filter and emits a post-ack tool change", async () => {
    let tools: readonly Tool[] = [tool("a")];
    let currentNow = 0;

    const service = new McpSubscriptionService(
      {
        tools: { list: () => tools },
        integrations: { list: () => [] },
      },
      {
        pollIntervalMs: 1,
        maxDurationMs: 5,
        wait: async () => {
          tools = [tool("a"), tool("b")];
          currentNow += 1;
        },
        now: () => currentNow,
      },
    );

    const values = [];
    for await (const value of service.listen({
      id: "listen-1",
      filter: {
        toolsListChanged: true,
        promptsListChanged: true,
        resourceSubscriptions: ["file:///ignored"],
      },
    })) {
      values.push(value);
    }

    expect(values[0]).toEqual({
      jsonrpc: "2.0",
      method: "notifications/subscriptions/acknowledged",
      params: {
        notifications: { toolsListChanged: true },
        _meta: {
          "io.modelcontextprotocol/subscriptionId": "listen-1",
        },
      },
    });
    expect(values[1]).toEqual({
      jsonrpc: "2.0",
      method: "notifications/tools/list_changed",
      params: {
        _meta: {
          "io.modelcontextprotocol/subscriptionId": "listen-1",
        },
      },
    });
    expect(values.at(-1)).toEqual({
      jsonrpc: "2.0",
      id: "listen-1",
      result: {},
    });
  });

  it("ends cleanly when the client aborts without sending an unsolicited notification", async () => {
    const controller = new AbortController();
    let currentNow = 0;
    const service = new McpSubscriptionService(
      {
        tools: { list: () => [tool("a")] },
        integrations: { list: () => [] },
      },
      {
        pollIntervalMs: 1,
        maxDurationMs: 10_000,
        wait: async () => {
          controller.abort();
          currentNow += 1;
        },
        now: () => currentNow,
      },
    );

    const values = [];
    for await (const value of service.listen({
      id: 42,
      filter: { toolsListChanged: false },
    }, controller.signal)) {
      values.push(value);
    }

    expect(values).toHaveLength(1);
    expect(values[0]?.method).toBe(
      "notifications/subscriptions/acknowledged",
    );
  });

  it("rejects malformed filters", async () => {
    const service = new McpSubscriptionService(
      {
        tools: { list: () => [] },
        integrations: { list: () => [] },
      },
      { pollIntervalMs: 0, maxDurationMs: 1 },
    );

    await expect(
      (async () => {
        for await (const _value of service.listen({
          id: "listen-1",
          filter: { resourceSubscriptions: new Array(33).fill("x") },
        })) {
          // Consume the stream so validation executes.
        }
      })(),
    ).rejects.toThrow("at most 32");
  });
}
