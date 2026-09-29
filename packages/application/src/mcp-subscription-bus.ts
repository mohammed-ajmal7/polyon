import type { McpSubscriptionNotification, McpSubscriptionFilter } from "./mcp-subscription-types";

export interface McpSubscriptionPublisher {
  toolsChanged(): void;
  promptsChanged(): void;
  resourcesChanged(): void;
  resourceUpdated(uri: string): void;
}

export class McpSubscriptionEventPublisher implements McpSubscriptionPublisher {
  constructor(private readonly bus: InMemoryMcpSubscriptionBus) {}

  toolsChanged(): void {
    this.bus.publish({ method: "notifications/tools/list_changed" });
  }

  promptsChanged(): void {
    this.bus.publish({ method: "notifications/prompts/list_changed" });
  }

  resourcesChanged(): void {
    this.bus.publish({ method: "notifications/resources/list_changed" });
  }

  resourceUpdated(uri: string): void {
    const normalizedUri = uri.trim();
    if (normalizedUri === "") {
      throw new Error("MCP resource URI is required.");
    }
    this.bus.publish({
      method: "notifications/resources/updated",
      params: { uri: normalizedUri },
    });
  }
}

export interface McpSubscriptionHandle {
  readonly subscriptionId: string;
  readonly acknowledged: McpSubscriptionFilter;
  readonly events: AsyncIterable<McpSubscriptionNotification>;
  close(): void;
}

interface Subscriber {
  readonly subscriptionId: string;
  readonly requestId: string;
  readonly filter: McpSubscriptionFilter;
  readonly queue: McpSubscriptionNotification[];
  resolve?: (event: IteratorResult<McpSubscriptionNotification>) => void;
  closed: boolean;
}

export class InMemoryMcpSubscriptionBus {
  private readonly subscribers = new Map<string, Subscriber>();
  private readonly requestSubscriptions = new Map<string, Set<string>>();
  private nextSubscriptionNumber = 1;

  subscribe(requestId: string, filter: McpSubscriptionFilter): McpSubscriptionHandle {
    const subscriptionId = `mcp-subscription:${this.nextSubscriptionNumber}`;
    this.nextSubscriptionNumber += 1;

    const subscriber: Subscriber = {
      subscriptionId,
      requestId,
      filter,
      queue: [],
      closed: false,
    };
    this.subscribers.set(subscriptionId, subscriber);

    const ids = this.requestSubscriptions.get(requestId) ?? new Set<string>();
    ids.add(subscriptionId);
    this.requestSubscriptions.set(requestId, ids);

    const close = (): void => this.close(subscriptionId);

    const events: AsyncIterable<McpSubscriptionNotification> = {
      [Symbol.asyncIterator]: (): AsyncIterator<McpSubscriptionNotification> => ({
        next: (): Promise<IteratorResult<McpSubscriptionNotification>> => {
          if (subscriber.queue.length > 0) {
            return Promise.resolve({ done: false, value: subscriber.queue.shift()! });
          }
          if (subscriber.closed) return Promise.resolve({ done: true, value: undefined });

          return new Promise((resolve) => {
            subscriber.resolve = resolve;
          });
        },
        return: (): Promise<IteratorResult<McpSubscriptionNotification>> => {
          close();
          return Promise.resolve({ done: true, value: undefined });
        },
      }),
    };

    return {
      subscriptionId,
      acknowledged: cloneFilter(filter),
      events,
      close,
    };
  }

  publish(notification: McpSubscriptionNotification): void {
    for (const subscriber of this.subscribers.values()) {
      if (subscriber.closed || !matches(subscriber.filter, notification)) continue;
      if (hasQueuedEquivalent(subscriber.queue, notification)) continue;

      if (subscriber.resolve !== undefined) {
        const resolve = subscriber.resolve;
        subscriber.resolve = undefined;
        resolve({ done: false, value: notification });
        continue;
      }

      if (subscriber.queue.length >= 64) subscriber.queue.shift();
      subscriber.queue.push(notification);
    }
  }

  close(subscriptionId: string): void {
    const subscriber = this.subscribers.get(subscriptionId);
    if (subscriber === undefined) return;

    this.subscribers.delete(subscriptionId);
    subscriber.closed = true;
    const ids = this.requestSubscriptions.get(subscriber.requestId);
    ids?.delete(subscriptionId);
    if (ids !== undefined && ids.size === 0) this.requestSubscriptions.delete(subscriber.requestId);

    const resolve = subscriber.resolve;
    subscriber.resolve = undefined;
    resolve?.({ done: true, value: undefined });
  }

  closeByRequestId(requestId: string): void {
    const ids = [...(this.requestSubscriptions.get(requestId) ?? [])];
    for (const subscriptionId of ids) this.close(subscriptionId);
  }
}

function matches(filter: McpSubscriptionFilter, notification: McpSubscriptionNotification): boolean {
  const notifications = filter.notifications;
  if (notifications === undefined) return false;

  switch (notification.method) {
    case "notifications/tools/list_changed":
      return notifications.toolsListChanged === true;
    case "notifications/prompts/list_changed":
      return notifications.promptsListChanged === true;
    case "notifications/resources/list_changed":
      return notifications.resourcesListChanged === true;
    case "notifications/resources/updated":
      return notifications.resourceSubscriptions?.includes(notification.params.uri) === true;
  }
}

function hasQueuedEquivalent(
  queue: readonly McpSubscriptionNotification[],
  notification: McpSubscriptionNotification,
): boolean {
  return queue.some((candidate) => {
    if (candidate.method !== notification.method) return false;
    if (candidate.method !== "notifications/resources/updated") return true;

    const candidateUri = candidate.params?.uri;
    const notificationUri =
      notification.method === "notifications/resources/updated"
        ? notification.params?.uri
        : undefined;
    return candidateUri === notificationUri;
  });
}

function cloneFilter(filter: McpSubscriptionFilter): McpSubscriptionFilter {
  if (filter.notifications === undefined) return {};
  return {
    notifications: {
      ...(filter.notifications.toolsListChanged === true ? { toolsListChanged: true } : {}),
      ...(filter.notifications.promptsListChanged === true ? { promptsListChanged: true } : {}),
      ...(filter.notifications.resourcesListChanged === true ? { resourcesListChanged: true } : {}),
      ...(filter.notifications.resourceSubscriptions === undefined
        ? {}
        : { resourceSubscriptions: [...filter.notifications.resourceSubscriptions] }),
    },
  };
}
