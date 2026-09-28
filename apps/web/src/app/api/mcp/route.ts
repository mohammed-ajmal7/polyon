import { authenticateRequest } from "@/server/auth";
import { getPolyonComposition, getPolyonPolicy } from "@/server/polyon-server";
import { McpServerService, type McpJsonRpcRequest } from "@polyon/application";

export const runtime = "nodejs";

const MAX_BYTES = 256_000;

export async function POST(request: Request): Promise<Response> {
  if (!(await authenticateRequest(request))) {
    return Response.json({ jsonrpc: "2.0", id: null, error: { code: -32001, message: "Authentication required." } }, { status: 401 });
  }

  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > MAX_BYTES) {
    return Response.json({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "MCP request exceeds its byte limit." } }, { status: 413 });
  }

  try {
    const input = JSON.parse(raw) as McpJsonRpcRequest;
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

    const result = await service.handle(input, {
      protocolVersion: request.headers.get("MCP-Protocol-Version") ?? undefined,
      method: request.headers.get("Mcp-Method") ?? undefined,
      name: request.headers.get("Mcp-Name") ?? undefined,
    });

    if (result === undefined) return new Response(null, { status: 204 });
    return Response.json(result);
  } catch (error) {
    return Response.json(
      { jsonrpc: "2.0", id: null, error: { code: -32600, message: error instanceof Error ? error.message : "Invalid MCP request." } },
      { status: 400 },
    );
  }
}

export async function GET(request: Request): Promise<Response> {
  if (!(await authenticateRequest(request))) return new Response("Authentication required.", { status: 401 });
  return Response.json({
    protocolVersion: "2026-07-28",
    methods: ["tools/list", "tools/call"],
    endpoint: new URL("/api/mcp", request.url).toString(),
  });
}
