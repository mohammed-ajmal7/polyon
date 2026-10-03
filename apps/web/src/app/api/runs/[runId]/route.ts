import { isAuthenticated } from "@/server/auth";
import { getBackgroundRun, getPersistentBackgroundRun } from "@/server/run-registry";
import { persistConversationHistory } from "@/server/chat-history";

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

  const run =
    process.env.VERCEL === "1"
      ? await getPersistentBackgroundRun(id)
      : getBackgroundRun(id);
  if (run === undefined) {
    return Response.json(
      { error: "This run is not known to the server. It may have been lost in a restart." },
      { status: 404 },
    );
  }

  if (
    process.env.VERCEL === "1" &&
    (run.status === "succeeded" || run.status === "failed")
  ) {
    try {
      await persistConversationHistory(id);
    } catch {
      // History persistence is best-effort and must not affect run status polling.
    }
  }

  return Response.json(run, { headers: { "Cache-Control": "no-store" } });
}
