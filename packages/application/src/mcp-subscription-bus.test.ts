import { describe, expect, it } from "vitest";

import { InMemoryMcpSubscriptionBus } from "./mcp-subscription-bus";

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

    const firstNext = first.events[Symbol.asyncIterator]().next();
    const secondNext = second.events[Symbol.asyncIterator]().next();
    const otherNext = other.events[Symbol.asyncIterator]().next();

    bus.closeByRequestId("same-request-id");

    expect(await first.events[Symbol.asyncIterator]().next()).toEqual({
      done: true,
      value: undefined,
    });
    expect(await second.events[Symbol.asyncIterator]().next()).toEqual({
      done: true,
      value: undefined,
    });

    bus.publish(toolsChanged);
    expect(await otherNext).toEqual({ done: false, value: toolsChanged });
    expect(await Promise.race([
      firstNext.then(() => "resolved"),
      Promise.resolve("pending"),
    ])).toBe("pending");
    expect(await Promise.race([
      secondNext.then(() => "resolved"),
      Promise.resolve("pending"),
    ])).toBe("pending");
  });
});
