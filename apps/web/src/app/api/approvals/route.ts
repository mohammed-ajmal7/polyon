import { isAuthenticated } from "@/server/auth";
import { getPolyonActorId, getPolyonComposition, isSameOrigin } from "@/server/polyon-server";

export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  const approvals = getPolyonComposition().stores.approvals
    .list()
    .filter((item) => item.status === "PENDING")
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
  return Response.json({ approvals });
}

export async function POST(request: Request): Promise<Response> {
  if (!isSameOrigin(request)) {
    return Response.json({ error: "Cross-origin POST requests are not allowed." }, { status: 403 });
  }
  try {
    const input = (await request.json()) as Record<string, unknown>;
    const approvalId = typeof input.approvalId === "string" ? input.approvalId.trim() : "";
    const status = input.status;
    if (approvalId === "") throw new Error("approvalId is required.");
    if (status !== "APPROVED" && status !== "REJECTED" && status !== "EXPIRED" && status !== "CANCELLED") {
      throw new Error("Invalid approval status.");
    }
    const polyon = getPolyonComposition();
    const approval = polyon.stores.approvals.get(approvalId);
    if (approval === undefined) throw new Error("Approval not found: " + approvalId + ".");
    const resolvedAt = new Date().toISOString();
    const resolvedBy = getPolyonActorId();
    if (approval.action === "EXECUTION_RUN") {
      if (approval.executionId === undefined) throw new Error("Execution approval has no execution binding.");
      const execution = polyon.stores.executions.get(approval.executionId);
      if (execution === undefined) throw new Error("Approved execution is not persisted.");
      const result = polyon.executionApproval.resolve(approval, execution, {
        status,
        resolvedAt,
        resolvedBy,
        ...(typeof input.rejectionReason === "string" ? { rejectionReason: input.rejectionReason } : {}),
      });
      return Response.json({ status: result.nextStep, approval: result.approval, execution: result.execution });
    }
    const result = await polyon.agentToolOrchestration.resolveToolApproval({
      approvalId,
      status,
      resolvedAt,
      resolvedBy,
    });
    return Response.json(result);
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Approval resolution failed." },
      { status: 400 },
    );
  }
}