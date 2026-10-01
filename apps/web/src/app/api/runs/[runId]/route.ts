import { isAuthenticated } from "@/server/auth";
import { getBackgroundRun } from "@/server/run-registry";

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
  if (id === "" || id.length > 200) {
    return Response.json({ error: "Invalid run id." }, { status: 400 });
  }

  const run = getBackgroundRun(id);
  if (run === undefined) {
    return Response.json(
      { error: "This run is not known to the server. It may have been lost in a restart." },
      { status: 404 },
    );
  }

  return Response.json(run, { headers: { "Cache-Control": "no-store" } });
}
