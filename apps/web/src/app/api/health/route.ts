import { isAuthenticated } from "@/server/auth";
import { getPolyonComposition } from "@/server/polyon-server";

export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  if (!(await isAuthenticated()))
    return Response.json({ error: "Authentication required." }, { status: 401 });
  const polyon = getPolyonComposition();
  return Response.json({
    status: "ok",
    runtime: polyon.runtime.health,
    counts: {
      agents: polyon.agents.list().length,
      models: polyon.models.list().length,
      providers: polyon.providers.list().length,
      integrations: polyon.integrations.list().length,
      pendingApprovals: polyon.stores.approvals.list().filter((item) => item.status === "PENDING")
        .length,
      executions: polyon.stores.executions.list().length,
    },
  });
}
