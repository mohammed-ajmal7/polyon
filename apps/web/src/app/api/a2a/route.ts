import { authenticateRequest } from "@/server/auth";
import { getPolyonComposition, getPolyonPolicy } from "@/server/polyon-server";
import { A2AServerService, type A2AJsonRpcRequest } from "@polyon/application";

export const runtime = "nodejs";
const MAX_BYTES = 256_000;

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
        error: { code: -32600, message: "A2A request exceeds its byte limit." },
      },
      { status: 413 },
    );
  }

  try {
    const input = JSON.parse(raw) as A2AJsonRpcRequest;
    const polyon = getPolyonComposition();
    const service = new A2AServerService({
      agents: {
        list: () => polyon.agents.list(),
      },
      commandIngress: polyon.commandIngress,
      conversationOrchestration: polyon.conversationOrchestration,
      executions: polyon.stores.executions,
      runtime: polyon.runtime,
      tasks: polyon.stores.tasks,
      policy: getPolyonPolicy(),
      actorId: "a2a-client",
    });
    return Response.json(await service.handle(input));
  } catch (error) {
    return Response.json(
      {
        jsonrpc: "2.0",
        id: null,
        error: {
          code: -32600,
          message: error instanceof Error ? error.message : "Invalid A2A request.",
        },
      },
      { status: 400 },
    );
  }
}
