import { authenticateRequest } from "@/server/auth";
import { getPolyonComposition, getPolyonPolicy } from "@/server/polyon-server";
import {
  McpServerService,
  McpSubscriptionService,
  type McpJsonRpcRequest,
  type McpSubscriptionFilter,
} from "@polyon/application";

export const runtime = "nodejs";

const MAX_BYTES = 256_000;

function wantsEventStream(request: Request): boolean {
  return (request.headers.get("accept") ?? "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .some(
      (value) => value === "text/event-stream" || value.startsWith("text/event-stream;"),
    );
}

function sseResponse(
  iterable: AsyncIterable<unknown>,
  signal: AbortSignal,
): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const item of iterable) {
          if (signal.aborted) break;
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(item)}\n\n`));
        }
      } catch (error) {
        if (!signal.aborted) {
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({
                jsonrpc: "2.0",
                id: null,
                error: {
                  code: -32603,
                  message: error instanceof Error ? error.message : "MCP stream failed.",
                },
              })}\n\n`,
            ),
          );
        }
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

function parseSubscriptionRequest(input: McpJsonRpcRequest): {
  readonly request?: { readonly id: string | number; readonly filter: McpSubscriptionFilter };
  readonly error?: { readonly code: number; readonly message: string };
} {
  if (input.id === undefined || input.id === null) {
    return {
      error: {
        code: -32602,
        message: "subscriptions/listen requires a non-null JSON-RPC request id.",
      },
    };
  }

  const notifications = input.params?.notifications;
  if (notifications === undefined || notifications === null || typeof notifications !== "object") {
    return {
      error: {
        code: -32602,
        message: "subscriptions/listen requires params.notifications.",
      },
    };
  }

  const record = notifications as Record<string, unknown>;
  const filter: McpSubscriptionFilter = {
    ...(record.toolsListChanged === undefined
      ? {}
      : { toolsListChanged: record.toolsListChanged as boolean }),
    ...(record.promptsListChanged === undefined
      ? {}
      : { promptsListChanged: record.promptsListChanged as boolean }),
    ...(record.resourcesListChanged === undefined
      ? {}
      : { resourcesListChanged: record.resourcesListChanged as boolean }),
    ...(record.resourceSubscriptions === undefined
      ? {}
      : { resourceSubscriptions: record.resourceSubscriptions as string[] }),
  };

  return { request: { id: input.id, filter } };
}

export async function POST(request: Request): Promise<Response> {
  if (!(await authenticateRequest(request))) {
    return Response.json(
      { jsonrpc: "2.0", id: null, error: { code: -32001, message: "Authentication required." } },
      { status: 401 },
    );
  }

  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > MAX_BYTES) {
    return Response.json(
      {
        jsonrpc: "2.0",
        id: null,
        error: { code: -32600, message: "MCP request exceeds its byte limit." },
      },
      { status: 413 },
    );
  }

  try {
    const input = JSON.parse(raw) as McpJsonRpcRequest;
    const polyon = getPolyonComposition();

    const protocolVersion = request.headers.get("MCP-Protocol-Version") ?? undefined;
    const methodHeader = request.headers.get("Mcp-Method") ?? undefined;
    const nameHeader = request.headers.get("Mcp-Name") ?? undefined;

    if (input.method === "subscriptions/listen") {
      if (protocolVersion !== "2026-07-28" || methodHeader !== input.method) {
        return Response.json(
          {
            jsonrpc: "2.0",
            id: input.id ?? null,
            error: {
              code: -32602,
              message: "MCP subscription requests require the 2026-07-28 protocol headers.",
            },
          },
          { status: 400 },
        );
      }

      if (!wantsEventStream(request)) {
        return Response.json(
          {
            jsonrpc: "2.0",
            id: input.id ?? null,
            error: {
              code: -32601,
              message: "subscriptions/listen requires Accept: text/event-stream.",
            },
          },
          { status: 406 },
        );
      }

      const parsed = parseSubscriptionRequest(input);
      if (parsed.error !== undefined) {
        return Response.json(
          { jsonrpc: "2.0", id: input.id ?? null, error: parsed.error },
          { status: 400 },
        );
      }

      const subscriptions = new McpSubscriptionService({
        tools: {
          list: () => polyon.tools.list(),
        },
        integrations: {
          list: () => polyon.integrations.list(),
        },
      });

      return sseResponse(
        subscriptions.listen(parsed.request!, request.signal),
        request.signal,
      );
    }

    const service = new McpServerService({
      tools: {
        list: () => polyon.tools.list(),
        get: (toolId) => polyon.tools.get(toolId),
      },
      integrations: {
        list: () => polyon.integrations.list(),
        get: (integrationId) => polyon.integrations.get(integrationId),
      },
      toolInvocation: polyon.toolInvocation,
      integrationInvocation: polyon.integrationInvocation,
      policy: getPolyonPolicy(),
      actorId: "mcp-client",
    });

    const result = await service.handle(input, {
      protocolVersion,
      method: methodHeader,
      name: nameHeader,
    });

    if (result === undefined) return new Response(null, { status: 204 });
    return Response.json(result);
  } catch (error) {
    return Response.json(
      {
        jsonrpc: "2.0",
        id: null,
        error: {
          code: -32600,
          message: error instanceof Error ? error.message : "Invalid MCP request.",
        },
      },
      { status: 400 },
    );
  }
}

export async function GET(request: Request): Promise<Response> {
  if (!(await authenticateRequest(request)))
    return new Response("Authentication required.", { status: 401 });
  return Response.json({
    protocolVersion: "2026-07-28",
    methods: ["server/discover", "tools/list", "tools/call", "subscriptions/listen"],
    capabilities: {
      tools: { listChanged: true },
    },
    endpoint: new URL("/api/mcp", request.url).toString(),
  });
}
