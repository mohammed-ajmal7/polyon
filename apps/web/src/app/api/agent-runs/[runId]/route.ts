import { TraceQueryService } from "@polyon/application";

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

  const polyon = getPolyonComposition();
  const run = polyon.agentRuns.get(id);
  if (run === undefined || run.userId !== getPolyonActorId()) {
    return Response.json({ error: "Agent run not found." }, { status: 404 });
  }

  const messages = run.messageIds
    .map((messageId) => polyon.stores.messages.get(messageId))
    .filter((message): message is NonNullable<typeof message> => message !== undefined);
  const evidence = run.evidenceIds
    .map((evidenceId) => polyon.stores.evidence.get(evidenceId))
    .filter((item): item is NonNullable<typeof item> => item !== undefined);
  const events = new TraceQueryService(polyon.stores.events).list({
    agentRunId: run.id,
    limit: 500,
  });

  return Response.json({ run, messages, evidence, events });
}
