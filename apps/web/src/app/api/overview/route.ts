import { isAuthenticated } from "@/server/auth";
import { getPolyonActorId, getPolyonComposition, sanitizeEventData } from "@/server/polyon-server";

export const runtime = "nodejs";

const MAX_ITEMS = 50;

export async function GET(): Promise<Response> {
  if (!(await isAuthenticated()))
    return Response.json({ error: "Authentication required." }, { status: 401 });
  const polyon = getPolyonComposition();
  const events = [...polyon.stores.events.list()].slice(-MAX_ITEMS).reverse();
  const approvals = polyon.stores.approvals
    .list()
    .filter((item) => item.status === "PENDING")
    .slice(0, MAX_ITEMS)
    .map((item) => ({
      id: item.id,
      action: item.action,
      riskLevel: item.riskLevel,
      reason: item.reason,
      requestedAt: item.requestedAt,
      missionId: item.missionId,
      taskId: item.taskId,
      executionId: item.executionId,
      toolId: item.toolId,
      integrationId: item.integrationId,
    }));

  return Response.json({
    actorId: getPolyonActorId(),
    runtime: polyon.runtime.health,
    agents: polyon.agents.list().map((agent) => ({
      id: agent.id,
      name: agent.name,
      role: agent.role,
      status: agent.status,
      preferredModelId: agent.preferredModelId,
    })),
    integrations: polyon.integrations.list().map((integration) => ({
      id: integration.integrationId,
      kind: integration.kind,
      operations: integration.supportedOperations,
      sideEffectClass: integration.sideEffectClass,
    })),
    approvals,
    counts: {
      executions: polyon.stores.executions.list().length,
      queued: polyon.runtime.health.queuedExecutionCount,
      active: polyon.runtime.health.activeExecutionCount,
      memories: polyon.stores.memory.list().length,
      sources: polyon.stores.sources.list().length,
      evidence: polyon.stores.evidence.list().length,
      debates: polyon.stores.debates.list().length,
      artifacts: polyon.stores.artifacts.list().length,
      events: polyon.stores.events.list().length,
    },
    activity: events.map((event) => ({
      id: event.id,
      kind: event.kind,
      occurredAt: event.occurredAt,
      missionId: event.missionId,
      taskId: event.taskId,
      executionId: event.executionId,
      conversationId: event.conversationId,
      data: sanitizeEventData(event.data),
    })),
  });
}
