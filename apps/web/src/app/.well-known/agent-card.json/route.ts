import { authenticateRequest } from "@/server/auth";
import { getPolyonBaseUrl, getPolyonComposition } from "@/server/polyon-server";
import { A2AServerService } from "@polyon/application";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  if (!(await authenticateRequest(request))) return Response.json({ error: "Authentication required." }, { status: 401 });

  const polyon = getPolyonComposition();
  const service = new A2AServerService({
    agents: { list: () => polyon.agents.list() },
    commandIngress: polyon.commandIngress,
    conversationOrchestration: polyon.conversationOrchestration,
    tasks: polyon.stores.tasks,
    policy: {
      id: "a2a-card",
      name: "A2A discovery",
      description: "Discovery policy.",
      approvalMode: "ASK_EVERYTHING",
      rules: [],
      defaultEffect: "REQUIRE_APPROVAL",
      enabled: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    actorId: "a2a-client",
  });

  return Response.json(service.agentCard(getPolyonBaseUrl(request)));
}
