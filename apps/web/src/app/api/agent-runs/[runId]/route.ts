import { isAuthenticated } from "@/server/auth";
import { getPolyonActorId, getPolyonComposition } from "@/server/polyon-server";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ runId: string }> },
): Promise<Response> {
  if (!(await isAuthenticated())) {
    return Response.json({ error: "Authentication required." }, { status: 401 });
  }

  const { runId } = await context.params;
  const id = runId.trim();

  if (id === "" || id.length > 160) {
    return Response.json({ error: "Invalid agent run id." }, { status: 400 });
  }

  const run = getPolyonComposition().agentRuns.get(id);
  if (run === undefined || run.userId !== getPolyonActorId()) {
    return Response.json({ error: "Agent run not found." }, { status: 404 });
  }

  return Response.json({ run });
}
