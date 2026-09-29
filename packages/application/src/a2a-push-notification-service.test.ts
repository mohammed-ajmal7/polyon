import { describe, expect, it } from "vitest";

import {
  A2APushNotificationService,
  InMemoryA2APushNotificationStore,
  createA2AWebhookSender,
} from "./a2a-push-notification-service";

const task = {
  id: "task-1",
  missionId: "mission-1",
  status: "SUCCEEDED",
  updatedAt: "2026-09-29T10:00:00.000Z",
} as never;

describe("A2A push notifications", () => {
  it("creates, lists, gets, and deletes task-scoped configs", () => {
    const store = new InMemoryA2APushNotificationStore();
    const service = new A2APushNotificationService({
      store,
      ownerId: "actor-1",
      sender: { send: async () => undefined },
      validateTask: (taskId) => taskId === "task-1",
    });

    const created = service.createConfig({
      taskId: "task-1",
      url: "https://client.example.test/a2a/push",
      token: "client-token",
    });

    expect(created.id).toBe("a2a-push:1");
    expect(service.getConfig("task-1", created.id)).toEqual(created);
    expect(service.listConfigs("task-1")).toEqual([created]);
    expect(service.deleteConfig("task-1", created.id)).toBe(true);
    expect(service.getConfig("task-1", created.id)).toBeUndefined();
  });

  it("does not expose another owner's configuration", () => {
    const store = new InMemoryA2APushNotificationStore();
    const created = store.create("owner-a", {
      taskId: "task-1",
      url: "https://client.example.test/a2a/push",
    });

    expect(store.get("owner-b", "task-1", created.id)).toBeUndefined();
    expect(store.list("owner-b", "task-1")).toEqual([]);
    expect(store.delete("owner-b", "task-1", created.id)).toBe(false);
  });

  it("does not expose configs for tasks outside the caller scope", () => {
    const store = new InMemoryA2APushNotificationStore();
    const service = new A2APushNotificationService({
      store,
      ownerId: "actor-1",
      sender: { send: async () => undefined },
      validateTask: (taskId) => taskId === "visible-task",
    });

    const created = store.create("actor-1", {
      taskId: "hidden-task",
      url: "https://client.example.test/a2a/push",
    });

    expect(service.getConfig("hidden-task", created.id)).toBeUndefined();
    expect(service.listConfigs("hidden-task")).toEqual([]);
    expect(service.deleteConfig("hidden-task", created.id)).toBe(false);
  });

  it("sends a v1 StreamResponse status update and isolates delivery failures", async () => {
    const sent: unknown[] = [];
    const store = new InMemoryA2APushNotificationStore();
    const service = new A2APushNotificationService({
      store,
      ownerId: "actor-1",
      sender: {
        send: async (_config, payload) => {
          sent.push(payload);
        },
      },
      validateTask: () => true,
    });

    service.createConfig({
      taskId: "task-1",
      url: "https://client.example.test/a2a/push",
    });

    await service.notifyTask(task);

    expect(sent).toEqual([
      {
        statusUpdate: {
          taskId: "task-1",
          contextId: "mission-1",
          status: {
            state: "TASK_STATE_COMPLETED",
            timestamp: "2026-09-29T10:00:00.000Z",
          },
        },
      },
    ]);
  });

  it("rejects non-HTTPS public webhook URLs", () => {
    const service = new A2APushNotificationService({
      store: new InMemoryA2APushNotificationStore(),
      ownerId: "actor-1",
      sender: { send: async () => undefined },
      validateTask: () => true,
    });

    expect(() =>
      service.createConfig({
        taskId: "task-1",
        url: "http://example.test/a2a/push",
      }),
    ).toThrow("HTTPS");
  });

  it("allows loopback URLs for local self-hosted clients", () => {
    const service = new A2APushNotificationService({
      store: new InMemoryA2APushNotificationStore(),
      ownerId: "actor-1",
      sender: { send: async () => undefined },
      validateTask: () => true,
    });

    expect(() =>
      service.createConfig({
        taskId: "task-1",
        url: "http://127.0.0.1:9090/a2a/push",
      }),
    ).not.toThrow();
  });

  it("enforces an outbound origin allowlist", async () => {
    const requests: Request[] = [];
    const sender = createA2AWebhookSender({
      allowedOrigins: ["https://allowed.example.test"],
      fetchImpl: async (input, init) => {
        requests.push(new Request(input, init));
        return new Response(null, { status: 204 });
      },
    });

    await sender.send(
      {
        id: "a2a-push:1",
        taskId: "task-1",
        url: "https://allowed.example.test/a2a/push",
        token: "token-1",
      },
      { statusUpdate: { taskId: "task-1" } },
    );

    expect(requests[0]?.headers.get("X-A2A-Notification-Token")).toBe("token-1");
    expect(requests[0]?.headers.get("content-type")).toBe("application/a2a+json");
    await expect(
      sender.send(
        {
          id: "a2a-push:2",
          taskId: "task-1",
          url: "https://blocked.example.test/a2a/push",
        },
        {},
      ),
    ).rejects.toThrow("allowlisted");
  });
});
