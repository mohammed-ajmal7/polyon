import { TraceQueryService } from "@polyon/application";
import { isAuthenticated } from "@/server/auth";
import { getPolyonActorId, getPolyonComposition, isSameOrigin } from "@/server/polyon-server";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ executionId: string }>;
}

export async function GET(_request: Request, context: RouteContext): Promise<Response> {
  if (!(await isAuthenticated())) {
    return Response.json({ error: "Authentication required." }, { status: 401 });
  }

  const { executionId } = await context.params;
  const polyon = getPolyonComposition();
  const execution = polyon.stores.executions.get(executionId);

  if (execution === undefined || execution.actorId !== getPolyonActorId()) {
    return Response.json({ error: "Execution not found." }, { status: 404 });
  }

  const task = polyon.stores.tasks.get(execution.taskId);
  const trace = new TraceQueryService(polyon.stores.events).list({
    executionId,
    limit: 200,
  });

  return Response.json({ execution, task, trace });
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  if (!(await isAuthenticated())) {
    return Response.json({ error: "Authentication required." }, { status: 401 });
  }
  if (!isSameOrigin(request)) {
    return Response.json({ error: "Cross-origin POST requests are not allowed." }, { status: 403 });
  }

  const { executionId } = await context.params;
  const polyon = getPolyonComposition();
  const actorId = getPolyonActorId();
  const execution = polyon.stores.executions.get(executionId);

  if (execution === undefined || execution.actorId !== actorId) {
    return Response.json({ error: "Execution not found." }, { status: 404 });
  }

  const result = polyon.runtime.cancel(executionId);
  if (result.status === "NOT_FOUND") {
    return Response.json({ error: "Execution not found." }, { status: 404 });
  }
  if (result.status === "NOT_CANCELLABLE") {
    return Response.json(
      { error: "Execution cannot be canceled in its current state." },
      { status: 409 },
    );
  }

  return Response.json({ execution: result.execution });
}
