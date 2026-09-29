import type { ActionKind, Policy, RiskLevel, Tool } from "@polyon/contracts";

import type { ToolInvocationService, ToolInvocationOutcome } from "./tool-invocation-service";
import type {
  IntegrationInvocationService,
  IntegrationInvocationOutcome,
} from "./integration-invocation-service";

export interface McpJsonRpcRequest {
  readonly jsonrpc: "2.0";
  readonly id?: string | number | null;
  readonly method: string;
  readonly params?: Record<string, unknown>;
}

export interface McpJsonRpcResponse {
  readonly jsonrpc: "2.0";
  readonly id: string | number | null;
  readonly result?: unknown;
  readonly error?: {
    readonly code: number;
    readonly message: string;
    readonly data?: unknown;
  };
}

export interface McpJsonRpcNotification {
  readonly jsonrpc: "2.0";
  readonly method: string;
  readonly params?: Record<string, unknown>;
  readonly _meta?: Record<string, unknown>;
}

export type McpStreamFrame = McpJsonRpcResponse | McpJsonRpcNotification;

export interface McpRequestHeaders {
  readonly protocolVersion?: string;
  readonly method?: string;
  readonly name?: string;
}

export interface McpServerOptions {
  readonly subscriptionMaxDurationMs?: number;
  readonly subscriptionWait?: (
    milliseconds: number,
    signal?: AbortSignal,
  ) => Promise<void>;
}

export interface McpServerDependencies {
  readonly tools: {
    list(): readonly Tool[];
    get(toolId: string): Tool | undefined;
  };
  readonly integrations: {
    list(): readonly {
      integrationId: string;
      kind: string;
      supportedOperations: readonly string[];
      actionKinds: readonly ActionKind[];
      sideEffectClass: string;
    }[];
    get(integrationId: string): unknown;
  };
  readonly toolInvocation: ToolInvocationService;
  readonly integrationInvocation: IntegrationInvocationService;
  readonly policy: Policy;
  readonly actorId: string;
  readonly subscriptions?: InMemoryMcpSubscriptionBus;
}

const MCP_TOOLS_PAGE_SIZE = 50;
const DEFAULT_SUBSCRIPTION_MAX_DURATION_MS = 300_000;
const MAX_SUBSCRIPTION_FILTER_URIS = 100;
const SUBSCRIPTION_ID_META_KEY = "io.modelcontextprotocol/subscriptionId";

export class McpServerService {
  private readonly subscriptions: InMemoryMcpSubscriptionBus;
  private readonly subscriptionMaxDurationMs: number;
  private readonly subscriptionWait: (
    milliseconds: number,
    signal?: AbortSignal,
  ) => Promise<void>;

  constructor(
    private readonly dependencies: McpServerDependencies,
    options: McpServerOptions = {},
  ) {
    this.subscriptions =
      dependencies.subscriptions ?? new InMemoryMcpSubscriptionBus();
    this.subscriptionMaxDurationMs =
      options.subscriptionMaxDurationMs ?? DEFAULT_SUBSCRIPTION_MAX_DURATION_MS;
    this.subscriptionWait = options.subscriptionWait ?? defaultWait;

    if (
      !Number.isInteger(this.subscriptionMaxDurationMs) ||
      this.subscriptionMaxDurationMs <= 0
    ) {
      throw new RangeError("MCP subscription maximum duration must be a positive integer.");
    }
  }

  async handle(
    request: McpJsonRpcRequest,
    headers: McpRequestHeaders,
  ): Promise<McpJsonRpcResponse | undefined> {
    if (request.jsonrpc !== "2.0") {
      return rpcError(request.id ?? null, -32600, "Invalid JSON-RPC request.");
    }

    if (headers.protocolVersion !== "2026-07-28") {
      return rpcError(request.id ?? null, -32602, "Unsupported MCP protocol version.");
    }

    if (headers.method !== request.method) {
      return rpcError(request.id ?? null, -32602, "Mcp-Method must match the JSON-RPC method.");
    }

    if (
      request.method === "notifications/initialized" ||
      request.method === "notifications/cancelled"
    ) {
      if (request.method === "notifications/cancelled") {
        const requestId =
          isRecord(request.params) &&
          (typeof request.params.requestId === "string" ||
            typeof request.params.requestId === "number")
            ? String(request.params.requestId)
            : undefined;
        if (requestId !== undefined) this.subscriptions.closeByRequestId(requestId);
      }
      return undefined;
    }

    if (request.method === "server/discover") {
      return {
        jsonrpc: "2.0",
        id: request.id ?? null,
        result: {
          protocolVersion: "2026-07-28",
          capabilities: {
            tools: { listChanged: true },
            prompts: { listChanged: false },
            resources: { listChanged: false, subscribe: false },
          },
          methods: [
            "server/discover",
            "tools/list",
            "tools/call",
            "subscriptions/listen",
          ],
        },
      };
    }

    if (request.method === "tools/list") {
      return this.listTools(request);
    }

    if (request.method === "subscriptions/listen") {
      return rpcError(
        request.id ?? null,
        -32004,
        "subscriptions/listen requires an SSE response.",
      );
    }

    if (request.method !== "tools/call") {
      return rpcError(request.id ?? null, -32601, "MCP method is not supported.");
    }

    const params = request.params ?? {};
    const name = typeof params.name === "string" ? params.name.trim() : "";
    if (name === "")
      return rpcError(request.id ?? null, -32602, "tools/call requires params.name.");

    if (headers.name !== name) {
      return rpcError(request.id ?? null, -32602, "Mcp-Name must match params.name.");
    }

    const input = params.arguments ?? {};
    const tool = this.dependencies.tools.get(name);

    if (tool !== undefined) {
      const action = selectAction(tool);
      const outcome = await this.dependencies.toolInvocation.invoke({
        invocationId: "mcp:" + String(request.id),
        toolId: tool.id,
        input,
        action,
        riskLevel: defaultRiskForAction(action),
        policy: this.dependencies.policy,
        decisionId: "mcp-policy:" + String(request.id),
        approvalRequestId: "mcp-approval:" + String(request.id),
        requestedBy: this.dependencies.actorId,
        requestedAt: new Date().toISOString(),
        evaluatedAt: new Date().toISOString(),
        actorId: this.dependencies.actorId,
      });

      return toolOutcomeResponse(request.id ?? null, outcome);
    }

    const integration = parseIntegrationToolId(name);
    if (integration === undefined) {
      return rpcError(request.id ?? null, -32602, "Unknown MCP tool.");
    }

    const registered = this.dependencies.integrations.get(integration.integrationId) as
      | {
          integrationId: string;
          supportedOperations: readonly string[];
          actionKinds: readonly ActionKind[];
          sideEffectClass: string;
        }
      | undefined;
    if (registered === undefined)
      return rpcError(request.id ?? null, -32602, "Unknown MCP integration.");
    if (!registered.supportedOperations.includes(integration.operation)) {
      return rpcError(request.id ?? null, -32602, "Unsupported MCP integration operation.");
    }

    const action = registered.actionKinds[0];
    if (action === undefined)
      return rpcError(request.id ?? null, -32602, "MCP integration has no action classification.");

    const outcome = await this.dependencies.integrationInvocation.invoke({
      invocationId: "mcp:" + String(request.id),
      integrationId: registered.integrationId,
      operation: integration.operation,
      input,
      action,
      riskLevel: defaultRiskForAction(action),
      policy: this.dependencies.policy,
      decisionId: "mcp-policy:" + String(request.id),
      approvalRequestId: "mcp-approval:" + String(request.id),
      requestedBy: this.dependencies.actorId,
      requestedAt: new Date().toISOString(),
      evaluatedAt: new Date().toISOString(),
      actorId: this.dependencies.actorId,
    });

    return toolOutcomeResponse(request.id ?? null, outcome);
  }

  async *stream(
    request: McpJsonRpcRequest,
    headers: McpRequestHeaders,
    signal?: AbortSignal,
  ): AsyncIterable<McpStreamFrame> {
    if (request.method !== "subscriptions/listen") {
      const response = await this.handle(request, headers);
      if (response !== undefined) yield response;
      return;
    }

    if (request.id === undefined || request.id === null) {
      yield rpcError(request.id ?? null, -32602, "subscriptions/listen requires a request id.");
      return;
    }

    const parsed = parseSubscriptionFilter(request.params);
    if (parsed.error !== undefined) {
      yield rpcError(request.id, -32602, parsed.error);
      return;
    }

    const requestId = String(request.id);
    const subscription = this.subscriptions.subscribe(requestId, parsed.filter);

    yield {
      jsonrpc: "2.0",
      method: "notifications/subscriptions/acknowledged",
      params: { notifications: parsed.filter.notifications ?? {} },
      _meta: { [SUBSCRIPTION_ID_META_KEY]: request.id },
    };

    const iterator = subscription.events[Symbol.asyncIterator]();
    const deadline = Date.now() + this.subscriptionMaxDurationMs;
    let abortListener: (() => void) | undefined;
    let abortPromise:
      | Promise<{ readonly kind: "aborted" }>
      | undefined;

    if (signal !== undefined) {
      abortPromise = new Promise((resolve) => {
        abortListener = () => resolve({ kind: "aborted" });
        if (signal.aborted) {
          abortListener();
          return;
        }
        signal.addEventListener("abort", abortListener, { once: true });
      });
    }

    try {
      while (!signal?.aborted) {
        const remaining = deadline - Date.now();
        if (remaining <= 0) {
          yield { jsonrpc: "2.0", id: request.id, result: {} };
          return;
        }

        const next = await Promise.race([
          iterator.next().then((result) => ({ kind: "event" as const, result })),
          this.subscriptionWait(remaining, signal).then(() => ({ kind: "deadline" as const })),
          ...(abortPromise === undefined ? [] : [abortPromise]),
        ]);

        if (next.kind === "aborted") return;

        if (next.kind === "deadline") {
          yield { jsonrpc: "2.0", id: request.id, result: {} };
          return;
        }

        if (next.result.done) return;

        const notification = next.result.value;
        yield {
          jsonrpc: "2.0",
          method: notification.method,
          ...(notification.params === undefined ? {} : { params: notification.params }),
          _meta: {
            ...(notification._meta ?? {}),
            [SUBSCRIPTION_ID_META_KEY]: request.id,
          },
        };
      }
    } finally {
      if (signal !== undefined && abortListener !== undefined) {
        signal.removeEventListener("abort", abortListener);
      }
      subscription.close();
    }
  }

  private listTools(request: McpJsonRpcRequest): McpJsonRpcResponse {
    const allTools = [
      ...this.dependencies.tools
        .list()
        .filter((tool) => tool.enabled)
        .map((tool) => ({
          name: tool.id,
          description: tool.description,
          inputSchema: tool.inputSchema ?? { type: "object", additionalProperties: true },
        })),
      ...this.dependencies.integrations.list().flatMap((integration) =>
        integration.supportedOperations.map((operation) => ({
          name: integrationToolId(integration.integrationId, operation),
          description: integration.kind + " integration " + operation,
          inputSchema: { type: "object", additionalProperties: true },
        })),
      ),
    ];

    const offsetResult = decodeToolsCursor(request.params?.cursor);
    if (typeof offsetResult !== "number") {
      return rpcError(request.id ?? null, -32602, offsetResult);
    }

    if (offsetResult > allTools.length) {
      return rpcError(request.id ?? null, -32602, "MCP tools/list cursor is out of range.");
    }

    const page = allTools.slice(offsetResult, offsetResult + MCP_TOOLS_PAGE_SIZE);
    const nextOffset = offsetResult + page.length;

    return {
      jsonrpc: "2.0",
      id: request.id ?? null,
      result: {
        tools: page,
        ...(nextOffset < allTools.length ? { nextCursor: encodeToolsCursor(nextOffset) } : {}),
        ttlMs: 10_000,
        cacheScope: "private",
      },
    };
  }
}

async function defaultWait(
  milliseconds: number,
  signal?: AbortSignal,
): Promise<void> {
  await new Promise<void>((resolve) => {
    let timer: ReturnType<typeof setTimeout> | undefined = globalThis.setTimeout(() => {
      timer = undefined;
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);

    const onAbort = (): void => {
      if (timer !== undefined) {
        globalThis.clearTimeout(timer);
        timer = undefined;
      }
      signal?.removeEventListener("abort", onAbort);
    };

    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) onAbort();
  });
}

function parseSubscriptionFilter(value: unknown): {
  readonly filter: McpSubscriptionFilter;
  readonly error?: string;
} {
  if (!isRecord(value)) {
    return { filter: {}, error: "subscriptions/listen params are required." };
  }

  const notificationsValue = value.notifications;
  if (!isRecord(notificationsValue)) {
    return { filter: {}, error: "subscriptions/listen notifications are required." };
  }

  const resourceSubscriptions = notificationsValue.resourceSubscriptions;
  if (resourceSubscriptions !== undefined) {
    if (
      !Array.isArray(resourceSubscriptions) ||
      resourceSubscriptions.length > MAX_SUBSCRIPTION_FILTER_URIS ||
      resourceSubscriptions.some(
        (uri) => typeof uri !== "string" || uri.trim() === "",
      )
    ) {
      return {
        filter: {},
        error: `resourceSubscriptions must contain 0-${MAX_SUBSCRIPTION_FILTER_URIS} non-empty strings.`,
      };
    }
  }

  const toolsListChanged = notificationsValue.toolsListChanged;
  const promptsListChanged = notificationsValue.promptsListChanged;
  const resourcesListChanged = notificationsValue.resourcesListChanged;

  if (
    toolsListChanged !== undefined &&
    typeof toolsListChanged !== "boolean"
  ) {
    return { filter: {}, error: "toolsListChanged must be boolean." };
  }
  if (
    promptsListChanged !== undefined &&
    typeof promptsListChanged !== "boolean"
  ) {
    return { filter: {}, error: "promptsListChanged must be boolean." };
  }
  if (
    resourcesListChanged !== undefined &&
    typeof resourcesListChanged !== "boolean"
  ) {
    return { filter: {}, error: "resourcesListChanged must be boolean." };
  }

  return {
    filter:
      toolsListChanged === true
        ? {
            notifications: {
              toolsListChanged: true,
            },
          }
        : {},
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function encodeToolsCursor(offset: number): string {
  return "mcp-tools:" + offset;
}

function decodeToolsCursor(value: unknown): number | string {
  if (value === undefined) return 0;
  if (typeof value !== "string" || !/^mcp-tools:\d+$/u.test(value)) {
    return "MCP tools/list cursor is invalid.";
  }
  const offset = Number(value.slice("mcp-tools:".length));
  if (!Number.isSafeInteger(offset) || offset < 0) {
    return "MCP tools/list cursor is invalid.";
  }
  return offset;
}

function toolOutcomeResponse(
  id: string | number | null,
  outcome: ToolInvocationOutcome | IntegrationInvocationOutcome,
): McpJsonRpcResponse {
  switch (outcome.status) {
    case "SUCCEEDED":
      return {
        jsonrpc: "2.0",
        id,
        result: { content: [{ type: "text", text: JSON.stringify(outcome.output) }] },
      };
    case "APPROVAL_REQUIRED":
      return {
        jsonrpc: "2.0",
        id,
        result: {
          isError: true,
          content: [
            {
              type: "text",
              text: "Human approval required.",
              approvalRequestId: outcome.approvalRequest.id,
            },
          ],
        },
      };
    case "REJECTED":
    case "FAILED":
      return {
        jsonrpc: "2.0",
        id,
        result: { isError: true, content: [{ type: "text", text: outcome.error }] },
      };
    default:
      return {
        jsonrpc: "2.0",
        id,
        error: { code: -32000, message: "MCP tool invocation failed." },
      };
  }
}

function rpcError(id: string | number | null, code: number, message: string): McpJsonRpcResponse {
  return {
    jsonrpc: "2.0",
    id,
    error: { code, message },
  };
}

function integrationToolId(integrationId: string, operation: string): string {
  return (
    "integration.invoke:" + encodeURIComponent(integrationId) + ":" + encodeURIComponent(operation)
  );
}

function parseIntegrationToolId(
  value: string,
): { integrationId: string; operation: string } | undefined {
  const prefix = "integration.invoke:";
  if (!value.startsWith(prefix)) return undefined;
  const remainder = value.slice(prefix.length);
  const separator = remainder.indexOf(":");
  if (separator <= 0) return undefined;
  try {
    return {
      integrationId: decodeURIComponent(remainder.slice(0, separator)),
      operation: decodeURIComponent(remainder.slice(separator + 1)),
    };
  } catch {
    return undefined;
  }
}

function selectAction(tool: Tool): ActionKind {
  const action = tool.actionKinds[0];
  if (action === undefined) throw new Error("MCP tool has no action classification.");
  return action;
}

function defaultRiskForAction(action: ActionKind): RiskLevel {
  switch (action) {
    case "READ":
      return "LOW";
    case "WRITE":
    case "TERMINAL":
    case "NETWORK":
    case "GIT":
    case "OTHER":
      return "MEDIUM";
    default:
      return "HIGH";
  }
}
