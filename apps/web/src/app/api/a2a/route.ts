import { authenticateRequest } from "@/server/auth";
import { getPolyonComposition, getPolyonPolicy } from "@/server/polyon-server";
import {
  A2AServerService,
  type A2AJsonRpcRequest,
  type A2AJsonRpcResponse,
} from "@polyon/application";

export const runtime = "nodejs";
const MAX_BYTES = 256_000;

const STREAMING_METHODS = new Set([
  "SendStreamingMessage",
  "message/stream",
  "SubscribeToTask",
  "tasks/subscribe",
  "tasks/resubscribe",
]);

function wantsEventStream(request: Request): boolean {
  return (request.headers.get("accept") ?? "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .some((value) => value === "text/event-stream" || value.startsWith("text/event-stream;"));
}

function isStreamingMethod(method: string): boolean {
  return STREAMING_METHODS.has(method);
}

function sseResponse(iterable: AsyncIterable<A2AJsonRpcResponse>, signal: AbortSignal): Response {
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
                  message: error instanceof Error ? error.message : "A2A stream failed.",
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
        error: { code: -32600, message: "A2A request exceeds its byte limit." },
      },
      { status: 413 },
    );
  }

  let input: A2AJsonRpcRequest;
  try {
    input = JSON.parse(raw) as A2AJsonRpcRequest;
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

  if (
    input === null ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    typeof input.method !== "string"
  ) {
    return Response.json(
      {
        jsonrpc: "2.0",
        id: null,
        error: { code: -32600, message: "A2A method is required." },
      },
      { status: 400 },
    );
  }

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
    ...(polyon.a2aPushNotifications === undefined
      ? {}
      : { pushNotifications: polyon.a2aPushNotifications }),
  });

  const version = request.headers.get("A2A-Version") ?? undefined;

  if (isStreamingMethod(input.method)) {
    if (!wantsEventStream(request)) {
      return Response.json(
        {
          jsonrpc: "2.0",
          id: input.id ?? null,
          error: {
            code: -32004,
            message: "A2A streaming operations require Accept: text/event-stream.",
          },
        },
        { status: 406 },
      );
    }

    return sseResponse(service.stream(input, { version }, request.signal), request.signal);
  }

  try {
    const result = await service.handle(input, { version });
    return Response.json(result);
  } catch (error) {
    return Response.json(
      {
        jsonrpc: "2.0",
        id: input.id ?? null,
        error: {
          code: -32600,
          message: error instanceof Error ? error.message : "Invalid A2A request.",
        },
      },
      { status: 400 },
    );
  }
}
