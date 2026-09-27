import type {
  ActionKind,
  Policy,
  RiskLevel,
  Tool,
} from "@polyon/contracts";

import type { ToolInvocationService, ToolInvocationOutcome } from "./tool-invocation-service";
import type { IntegrationInvocationService, IntegrationInvocationOutcome } from "./integration-invocation-service";

export interface McpJsonRpcRequest {
  readonly jsonrpc: "2.0";
  readonly id: string | number | null;
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
}

export class McpServerService {
  constructor(private readonly dependencies: McpServerDependencies) {}

  async handle(
    request: McpJsonRpcRequest,
    headers: {
      readonly protocolVersion?: string;
      readonly method?: string;
      readonly name?: string;
    },
  ): Promise<McpJsonRpcResponse> {
    if (request.jsonrpc !== "2.0") {
      return rpcError(request.id, -32600, "Invalid JSON-RPC request.");
    }

    if (headers.protocolVersion !== "2026-07-28") {
      return rpcError(request.id, -32602, "Unsupported MCP protocol version.");
    }

    if (headers.method !== request.method) {
      return rpcError(request.id, -32602, "Mcp-Method must match the JSON-RPC method.");
    }

    if (request.method === "server/discover") {
      return {
        jsonrpc: "2.0",
        id: request.id,
        result: {
          protocolVersion: "2026-07-28",
          capabilities: {
            tools: { listChanged: false },
          },
          methods: ["server/discover", "tools/list", "tools/call"],
        },
      };
    }

    if (request.method === "tools/list") {
      return {
        jsonrpc: "2.0",
        id: request.id,
        result: {
          tools: [
            ...this.dependencies.tools.list()
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
          ],
          ttlMs: 10_000,
          cacheScope: "private",
        },
      };
    }

    if (request.method !== "tools/call") {
      return rpcError(request.id, -32601, "MCP method is not supported.");
    }

    const params = request.params ?? {};
    const name = typeof params.name === "string" ? params.name.trim() : "";
    if (name === "") return rpcError(request.id, -32602, "tools/call requires params.name.");

    if (headers.name !== name) {
      return rpcError(request.id, -32602, "Mcp-Name must match params.name.");
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

      return toolOutcomeResponse(request.id, outcome);
    }

    const integration = parseIntegrationToolId(name);
    if (integration === undefined) {
      return rpcError(request.id, -32602, "Unknown MCP tool.");
    }

    const registered = this.dependencies.integrations.get(integration.integrationId) as
      | { integrationId: string; supportedOperations: readonly string[]; actionKinds: readonly ActionKind[]; sideEffectClass: string }
      | undefined;
    if (registered === undefined) return rpcError(request.id, -32602, "Unknown MCP integration.");
    if (!registered.supportedOperations.includes(integration.operation)) {
      return rpcError(request.id, -32602, "Unsupported MCP integration operation.");
    }

    const action = registered.actionKinds[0];
    if (action === undefined) return rpcError(request.id, -32602, "MCP integration has no action classification.");

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

    return toolOutcomeResponse(request.id, outcome);
  }
}

function toolOutcomeResponse(id: string | number | null, outcome: ToolInvocationOutcome | IntegrationInvocationOutcome): McpJsonRpcResponse {
  switch (outcome.status) {
    case "SUCCEEDED":
      return { jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify(outcome.output) }] } };
    case "APPROVAL_REQUIRED":
      return { jsonrpc: "2.0", id, result: { isError: true, content: [{ type: "text", text: "Human approval required.", approvalRequestId: outcome.approvalRequest.id }] } };
    case "REJECTED":
    case "FAILED":
      return { jsonrpc: "2.0", id, result: { isError: true, content: [{ type: "text", text: outcome.error }] } };
    default:
      return { jsonrpc: "2.0", id, error: { code: -32000, message: "MCP tool invocation failed." } };
  }
}

function rpcError(
  id: string | number | null,
  code: number,
  message: string,
): McpJsonRpcResponse {
  return {
    jsonrpc: "2.0",
    id,
    error: { code, message },
  };
}

function integrationToolId(integrationId: string, operation: string): string {
  return "integration.invoke:" + encodeURIComponent(integrationId) + ":" + encodeURIComponent(operation);
}

function parseIntegrationToolId(value: string): { integrationId: string; operation: string } | undefined {
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
