import { isAuthenticated } from "@/server/auth";
import { executionEnabled, getPolyonComposition } from "@/server/polyon-server";

export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  if (!(await isAuthenticated())) {
    return Response.json({ error: "Authentication required." }, { status: 401 });
  }

  const polyon = getPolyonComposition();
  const modelConfigured = polyon.agents.list().some(
    (agent) => agent.status === "ACTIVE" && agent.preferredModelId !== undefined,
  );
  const emailConfigured = polyon.integrations.list().some(
    (integration) => integration.kind === "EMAIL",
  );
  const researchConfigured = polyon.research !== undefined;

  const checks = {
    storage: true,
    runtime: polyon.runtime.health.status === "RUNNING",
    modelConfigured,
    emailConfigured,
    researchConfigured,
    executionEnabled: executionEnabled(),
    authenticationEnabled: (process.env.POLYON_API_TOKEN?.trim() ?? "") !== "",
  };

  const ready =
    checks.storage &&
    checks.runtime &&
    (!checks.executionEnabled || checks.modelConfigured);

  return Response.json(
    {
      status: ready ? "ready" : "not_ready",
      checks,
    },
    { status: ready ? 200 : 503 },
  );
}
