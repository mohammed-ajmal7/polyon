import { authenticateRequest } from "@/server/auth";
import { getPolyonBaseUrl, getPolyonComposition, getPolyonPolicy } from "@/server/polyon-server";
import { A2AServerService } from "@polyon/application";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  if (!(await authenticateRequest(request))) {
    return Response.json(
      { error: "Authentication required." },
      { status: 401 },
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

  return new Response(
    JSON.stringify(service.extendedAgentCard(getPolyonBaseUrl(request))),
    {
      status: 200,
      headers: {
        "Content-Type": "application/a2a+json",
        "Cache-Control": "private, no-store",
      },
    },
  );
}
