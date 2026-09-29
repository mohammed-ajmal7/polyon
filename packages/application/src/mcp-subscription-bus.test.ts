import { describe, expect, it } from "vitest";

import { InMemoryMcpSubscriptionBus, McpSubscriptionEventPublisher } from "./mcp-subscription-bus";

const toolsChanged = {
  method: "notifications/tools/list_changed" as const,
};

describe("InMemoryMcpSubscriptionBus", () => {
  it("filters notifications and wakes a waiting subscriber", async () => {
    const bus = new InMemoryMcpSubscriptionBus();
    const subscription = bus.subscribe("client-request-1", {
      notifications: { toolsListChanged: true },
    });
    const iterator = subscription.events[Symbol.asyncIterator]();

    const pending = iterator.next();
    bus.publish(toolsChanged);

    expect(await pending).toEqual({ done: false, value: toolsChanged });
    expect(subscription.acknowledged).toEqual({
      notifications: { toolsListChanged: true },
    });

    subscription.close();
    expect(await iterator.next()).toEqual({ done: true, value: undefined });
  });

  it("does not deliver duplicate queued level-trigger notifications", async () => {
    const bus = new InMemoryMcpSubscriptionBus();
    const subscription = bus.subscribe("client-request-2", {
      notifications: { toolsListChanged: true },
    });

    bus.publish(toolsChanged);
    bus.publish(toolsChanged);

    const iterator = subscription.events[Symbol.asyncIterator]();
    expect(await iterator.next()).toEqual({ done: false, value: toolsChanged });

    let settled = false;
    const pending = iterator.next().then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    subscription.close();
    await pending;
  });

  it("publishes typed tool and resource change notifications", async () => {
    const bus = new InMemoryMcpSubscriptionBus();
    const publisher = new McpSubscriptionEventPublisher(bus);
    const tools = bus.subscribe("tools", {
      notifications: { toolsListChanged: true },
    });
    const resources = bus.subscribe("resources", {
      notifications: { resourceSubscriptions: ["memory://one"] },
    });

    const toolsIterator = tools.events[Symbol.asyncIterator]();
    const resourcesIterator = resources.events[Symbol.asyncIterator]();

    publisher.toolsChanged();
    publisher.resourceUpdated(" memory://one ");

    expect(await toolsIterator.next()).toEqual({
      done: false,
      value: { method: "notifications/tools/list_changed" },
    });
    expect(await resourcesIterator.next()).toEqual({
      done: false,
      value: {
        method: "notifications/resources/updated",
        params: { uri: "memory://one" },
      },
    });

    tools.close();
    resources.close();
  });

  it("rejects empty resource update URIs", () => {
    const publisher = new McpSubscriptionEventPublisher(new InMemoryMcpSubscriptionBus());
    expect(() => publisher.resourceUpdated("   ")).toThrow("resource URI is required");
  });

  it("isolates matching subscriptions and cancels all streams for one request id", async () => {
    const bus = new InMemoryMcpSubscriptionBus();
    const first = bus.subscribe("same-request-id", {
      notifications: { toolsListChanged: true },
    });
    const second = bus.subscribe("same-request-id", {
      notifications: { toolsListChanged: true },
    });
    const other = bus.subscribe("other-request-id", {
      notifications: { toolsListChanged: true },
    });

    const firstIterator = first.events[Symbol.asyncIterator]();
    const secondIterator = second.events[Symbol.asyncIterator]();
    const otherIterator = other.events[Symbol.asyncIterator]();

    bus.publish(toolsChanged);

    expect(await firstIterator.next()).toEqual({ done: false, value: toolsChanged });
    expect(await secondIterator.next()).toEqual({ done: false, value: toolsChanged });
    expect(await otherIterator.next()).toEqual({ done: false, value: toolsChanged });

    bus.closeByRequestId("same-request-id");

    expect(await firstIterator.next()).toEqual({ done: true, value: undefined });
    expect(await secondIterator.next()).toEqual({ done: true, value: undefined });

    bus.publish(toolsChanged);
    expect(await otherIterator.next()).toEqual({ done: false, value: toolsChanged });
  });
});
