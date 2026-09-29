import { authenticateRequest } from "@/server/auth";
import { getPolyonComposition, getPolyonPolicy } from "@/server/polyon-server";
import {
  McpServerService,
  type McpJsonRpcRequest,
  type McpJsonRpcResponse,
  type McpRequestHeaders,
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
  iterable: AsyncIterable<McpJsonRpcResponse>,
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

  let input: McpJsonRpcRequest;
  try {
    input = JSON.parse(raw) as McpJsonRpcRequest;
  } catch {
    return Response.json(
      {
        jsonrpc: "2.0",
        id: null,
        error: { code: -32700, message: "Invalid JSON payload." },
      },
      { status: 400 },
    );
  }

  const polyon = getPolyonComposition();
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

  const headers: McpRequestHeaders = {
    protocolVersion: request.headers.get("MCP-Protocol-Version") ?? undefined,
    method: request.headers.get("Mcp-Method") ?? undefined,
    name: request.headers.get("Mcp-Name") ?? undefined,
  };

  if (wantsEventStream(request) && input.method !== "notifications/initialized") {
    return sseResponse(service.stream(input, headers), request.signal);
  }

  try {
    const result = await service.handle(input, headers);
    if (result === undefined) return new Response(null, { status: 204 });
    return Response.json(result);
  } catch (error) {
    return Response.json(
      {
        jsonrpc: "2.0",
        id: input.id ?? null,
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
    methods: ["server/discover", "tools/list", "tools/call"],
    streaming: true,
    endpoint: new URL("/api/mcp", request.url).toString(),
  });
}
