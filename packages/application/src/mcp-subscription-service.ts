import type { ActionKind, Tool } from "@polyon/contracts";

export interface McpSubscriptionFilter {
  readonly toolsListChanged?: boolean;
  readonly promptsListChanged?: boolean;
  readonly resourcesListChanged?: boolean;
  readonly resourceSubscriptions?: readonly string[];
}

export interface McpSubscriptionListenRequest {
  readonly id: string | number;
  readonly filter: McpSubscriptionFilter;
}

export interface McpSubscriptionAcknowledgedEvent {
  readonly jsonrpc: "2.0";
  readonly method: "notifications/subscriptions/acknowledged";
  readonly params: {
    readonly notifications: McpSubscriptionFilter;
    readonly _meta: {
      readonly "io.modelcontextprotocol/subscriptionId": string | number;
    };
  };
}

export interface McpSubscriptionNotificationEvent {
  readonly jsonrpc: "2.0";
  readonly method:
    | "notifications/tools/list_changed"
    | "notifications/prompts/list_changed"
    | "notifications/resources/list_changed";
  readonly params: {
    readonly _meta: {
      readonly "io.modelcontextprotocol/subscriptionId": string | number;
    };
  };
}

export interface McpSubscriptionCloseResponse {
  readonly jsonrpc: "2.0";
  readonly id: string | number;
  readonly result: Record<string, never>;
}

export type McpSubscriptionStreamEvent =
  | McpSubscriptionAcknowledgedEvent
  | McpSubscriptionNotificationEvent
  | McpSubscriptionCloseResponse;

export interface McpSubscriptionServerDependencies {
  readonly tools: {
    list(): readonly Tool[];
  };
  readonly integrations: {
    list(): readonly {
      integrationId: string;
      kind: string;
      supportedOperations: readonly string[];
      actionKinds: readonly ActionKind[];
      sideEffectClass: string;
    }[];
  };
}

export interface McpSubscriptionServerOptions {
  readonly pollIntervalMs?: number;
  readonly maxDurationMs?: number;
  readonly wait?: (milliseconds: number) => Promise<void>;
  readonly now?: () => number;
}

const DEFAULT_POLL_INTERVAL_MS = 1_000;
const DEFAULT_MAX_DURATION_MS = 300_000;
const MAX_RESOURCE_SUBSCRIPTIONS = 32;

export class McpSubscriptionService {
  private readonly pollIntervalMs: number;
  private readonly maxDurationMs: number;
  private readonly wait: (milliseconds: number) => Promise<void>;
  private readonly now: () => number;

  constructor(
    private readonly dependencies: McpSubscriptionServerDependencies,
    options: McpSubscriptionServerOptions = {},
  ) {
    this.pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.maxDurationMs = options.maxDurationMs ?? DEFAULT_MAX_DURATION_MS;
    this.wait = options.wait ?? defaultWait;
    this.now = options.now ?? Date.now;

    if (!Number.isInteger(this.pollIntervalMs) || this.pollIntervalMs < 0) {
      throw new RangeError("MCP subscription poll interval must be a non-negative integer.");
    }
    if (!Number.isInteger(this.maxDurationMs) || this.maxDurationMs <= 0) {
      throw new RangeError("MCP subscription maximum duration must be a positive integer.");
    }
  }

  async *listen(
    request: McpSubscriptionListenRequest,
    signal?: AbortSignal,
  ): AsyncIterable<McpSubscriptionStreamEvent> {
    const filter = normalizeFilter(request.filter);
    if (filter.error !== undefined) {
      throw new Error(filter.error);
    }

    const acknowledged = filter.value!;
    const subscriptionId = request.id;

    yield {
      jsonrpc: "2.0",
      method: "notifications/subscriptions/acknowledged",
      params: {
        notifications: acknowledged,
        _meta: {
          "io.modelcontextprotocol/subscriptionId": subscriptionId,
        },
      },
    };

    const initial = snapshot(this.dependencies);
    const deadline = this.now() + this.maxDurationMs;

    while (this.now() < deadline) {
      if (signal?.aborted) return;

      await this.wait(this.pollIntervalMs);
      if (signal?.aborted) return;

      const current = snapshot(this.dependencies);
      if (acknowledged.toolsListChanged === true && current.tools !== initial.tools) {
        yield {
          jsonrpc: "2.0",
          method: "notifications/tools/list_changed",
          params: {
            _meta: {
              "io.modelcontextprotocol/subscriptionId": subscriptionId,
            },
          },
        };
      }

      if (current.tools !== initial.tools) {
        return;
      }
    }

    if (!signal?.aborted) {
      yield {
        jsonrpc: "2.0",
        id: request.id,
        result: {},
      };
    }
  }
}

function normalizeFilter(filter: McpSubscriptionFilter):
  | { readonly value: McpSubscriptionFilter; readonly error?: undefined }
  | { readonly value?: undefined; readonly error: string } {
  const resourceSubscriptions = filter.resourceSubscriptions ?? [];
  if (!Array.isArray(resourceSubscriptions) || resourceSubscriptions.length > MAX_RESOURCE_SUBSCRIPTIONS) {
    return { error: `MCP resource subscription list must contain at most ${MAX_RESOURCE_SUBSCRIPTIONS} URIs.` };
  }
  if (resourceSubscriptions.some((uri) => typeof uri !== "string" || uri.trim() === "")) {
    return { error: "MCP resource subscription URIs must be non-empty strings." };
  }
  if (filter.toolsListChanged !== undefined && typeof filter.toolsListChanged !== "boolean") {
    return { error: "MCP toolsListChanged must be a boolean." };
  }
  if (filter.promptsListChanged !== undefined && typeof filter.promptsListChanged !== "boolean") {
    return { error: "MCP promptsListChanged must be a boolean." };
  }
  if (filter.resourcesListChanged !== undefined && typeof filter.resourcesListChanged !== "boolean") {
    return { error: "MCP resourcesListChanged must be a boolean." };
  }

  return {
    value: {
      ...(filter.toolsListChanged === true ? { toolsListChanged: true } : {}),
    },
  };
}

interface McpSubscriptionSnapshot {
  readonly tools: string;
}

function snapshot(dependencies: McpSubscriptionServerDependencies): McpSubscriptionSnapshot {
  const tools = [
    ...dependencies.tools.list().filter((tool) => tool.enabled).map((tool) => ({
      name: tool.id,
      description: tool.description,
      inputSchema: tool.inputSchema ?? { type: "object" },
    })),
    ...dependencies.integrations.list().flatMap((integration) =>
      integration.supportedOperations.map((operation) => ({
        name: "integration.invoke:" +
          encodeURIComponent(integration.integrationId) +
          ":" +
          encodeURIComponent(operation),
        description: integration.kind + " integration " + operation,
      })),
    ),
  ];

  tools.sort((left, right) => left.name.localeCompare(right.name));
  return { tools: JSON.stringify(tools) };
}

function defaultWait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, milliseconds));
}
