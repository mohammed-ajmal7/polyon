import { isAuthenticated } from "@/server/auth";
import { getPolyonComposition } from "@/server/polyon-server";
import { TraceQueryService } from "@polyon/application";

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

  if (execution === undefined) {
    return Response.json({ error: "Execution not found." }, { status: 404 });
  }

  const task = polyon.stores.tasks.get(execution.taskId);
  const trace = new TraceQueryService(polyon.stores.events).list({
    executionId,
    limit: 200,
  });

  return Response.json({ execution, task, trace });
}
