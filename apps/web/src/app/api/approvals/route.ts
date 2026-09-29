import { isAuthenticated } from "@/server/auth";
import {
  getPolyonActorId,
  getPolyonComposition,
  getPolyonPolicy,
  isSameOrigin,
} from "@/server/polyon-server";
import { buildApprovalPreview, explainApprovalReason } from "@/server/approval-preview";
import { readBoundedText } from "@/server/bounded-body";

export const runtime = "nodejs";
const MAX_REQUEST_BYTES = 16_384;

export async function GET(): Promise<Response> {
  if (!(await isAuthenticated()))
    return Response.json({ error: "Authentication required." }, { status: 401 });
  const approvals = getPolyonComposition()
    .stores.approvals.list()
    .filter((item) => item.status === "PENDING")
    .map((item) => ({
      id: item.id,
      action: item.action,
      riskLevel: item.riskLevel,
      reason: explainApprovalReason(item.reason),
      requestedAt: item.requestedAt,
      missionId: item.missionId,
      taskId: item.taskId,
      executionId: item.executionId,
      toolId: item.toolId,
      integrationId: item.integrationId,
      preview: buildApprovalPreview(item),
    }));
  return Response.json({ approvals });
}

export async function POST(request: Request): Promise<Response> {
  if (!(await isAuthenticated()))
    return Response.json({ error: "Authentication required." }, { status: 401 });
  if (!isSameOrigin(request)) {
    return Response.json({ error: "Cross-origin POST requests are not allowed." }, { status: 403 });
  }
  try {
    const raw = await readBoundedText(request, MAX_REQUEST_BYTES);
    if (raw === undefined) {
      return Response.json(
        { error: "Approval request exceeds the 16384-byte limit." },
        { status: 413 },
      );
    }
    const input = JSON.parse(raw) as Record<string, unknown>;
    const approvalId = typeof input.approvalId === "string" ? input.approvalId.trim() : "";
    const status = input.status;
    if (approvalId === "") throw new Error("approvalId is required.");
    if (
      status !== "APPROVED" &&
      status !== "REJECTED" &&
      status !== "EXPIRED" &&
      status !== "CANCELLED"
    ) {
      throw new Error("Invalid approval status.");
    }
    const polyon = getPolyonComposition();
    const approval = polyon.stores.approvals.get(approvalId);
    if (approval === undefined) throw new Error("Approval not found: " + approvalId + ".");
    const resolvedAt = new Date().toISOString();
    const resolvedBy = getPolyonActorId();
    if (approval.action === "PLAN_APPLY") {
      const result = polyon.missionPlan.resolveApproval({
        approvalId,
        status,
        resolvedAt,
        resolvedBy,
      });

      if (result.status === "APPLIED") {
        polyon.taskOrchestration.advanceReadyTasks({
          missionId: result.mission.id,
          actorId: resolvedBy,
          now: resolvedAt,
        });
        const running = polyon.missionLifecycle.transition({
          missionId: result.mission.id,
          to: "RUNNING",
          actorId: resolvedBy,
          eventId: "MISSION_STATUS_CHANGED:" + result.mission.id + ":RUNNING:" + resolvedAt,
          now: resolvedAt,
          causedByEventId: result.events[result.events.length - 1]?.id,
        });
        const execution = polyon.missionGraphExecution.executeReadyTasks({
          missionId: result.mission.id,
          actorId: resolvedBy,
          requiredCapabilityIds: [],
          policy: getPolyonPolicy(),
          riskLevel: result.approval.riskLevel,
          now: resolvedAt,
          identities: {
            executionId: (taskId, attempt) => "execution-" + taskId + "-" + attempt,
            policyDecisionId: (taskId, executionId) => "decision-" + taskId + "-" + executionId,
            approvalRequestId: (taskId, executionId) => "approval-" + taskId + "-" + executionId,
          },
        });
        return Response.json({
          status: result.status,
          approval: result.approval,
          mission: running.mission,
          execution,
        });
      }

      // A rejected, expired or cancelled plan leaves no work to run; return the mission to
      // WAITING so it is not stranded in PLANNING and can be planned again.
      const waiting = polyon.missionLifecycle.transition({
        missionId: result.mission.id,
        to: "WAITING",
        actorId: resolvedBy,
        eventId: "MISSION_STATUS_CHANGED:" + result.mission.id + ":WAITING:" + resolvedAt,
        now: resolvedAt,
        causedByEventId: result.events[result.events.length - 1]?.id,
      });
      return Response.json({ ...result, mission: waiting.mission });
    }

    if (approval.action === "EXECUTION_RUN") {
      if (approval.executionId === undefined)
        throw new Error("Execution approval has no execution binding.");
      const execution = polyon.stores.executions.get(approval.executionId);
      if (execution === undefined) throw new Error("Approved execution is not persisted.");
      const result = polyon.executionApproval.resolve(approval, execution, {
        status,
        resolvedAt,
        resolvedBy,
        ...(typeof input.rejectionReason === "string"
          ? { rejectionReason: input.rejectionReason }
          : {}),
      });
      return Response.json({
        status: result.nextStep,
        approval: result.approval,
        execution: result.execution,
      });
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
