import { randomUUID } from "node:crypto";

import { isAuthenticated } from "@/server/auth";
import {
  executionEnabled,
  getPolyonActorId,
  getPolyonComposition,
  getPolyonPolicy,
} from "@/server/polyon-server";

export const runtime = "nodejs";

const MAX_REQUEST_BYTES = 32_768;

export async function POST(request: Request): Promise<Response> {
  if (!(await isAuthenticated())) {
    return Response.json({ error: "Authentication required." }, { status: 401 });
  }
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  if (origin !== null && (host === null || new URL(origin).host !== host)) {
    return Response.json({ error: "Cross-origin POST requests are not allowed." }, { status: 403 });
  }

  try {
    if (!executionEnabled()) {
      return Response.json(
        { error: "Execution is disabled. Set POLYON_EXECUTION_ENABLED=true." },
        { status: 503 },
      );
    }

    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > MAX_REQUEST_BYTES) {
      return Response.json(
        { error: "Mission plan request exceeds the 32768-byte limit." },
        { status: 413 },
      );
    }

    const input = JSON.parse(raw) as Record<string, unknown>;
    const missionId = stringInput(input.missionId, 200, "missionId");
    const planningAgentId = stringInput(input.planningAgentId, 200, "planningAgentId");
    const polyon = getPolyonComposition();
    const result = await polyon.missionPlanOrchestration.plan({
      missionId,
      planningAgentId,
      requiredCapabilityIds: stringArray(input.requiredCapabilityIds),
      proposalId: optional(input.proposalId) ?? randomUUID(),
      decisionId: optional(input.decisionId) ?? randomUUID(),
      approvalRequestId: optional(input.approvalRequestId) ?? randomUUID(),
      actorId: getPolyonActorId(),
      policy: getPolyonPolicy(),
      riskLevel: riskLevel(input.riskLevel),
      createdAt: new Date().toISOString(),
      requestedAt: new Date().toISOString(),
      evaluatedAt: new Date().toISOString(),
    });

    return Response.json(result, { status: 201 });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Mission planning failed." },
      { status: 400 },
    );
  }
}

function optional(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

function stringInput(value: unknown, max: number, field: string): string {
  const result = optional(value);
  if (result === undefined) throw new Error(field + " is required.");
  if (Array.from(result).length > max) throw new Error(field + " exceeds its bound.");
  return result;
}

function stringArray(value: unknown): readonly string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 20) {
    throw new Error("requiredCapabilityIds must contain at most 20 ids.");
  }
  return value.map((item) => stringInput(item, 200, "capabilityId"));
}

function riskLevel(value: unknown): "LOW" | "MEDIUM" | "HIGH" {
  if (value === undefined || value === "LOW") return "LOW";
  if (value === "MEDIUM" || value === "HIGH") return value;
  throw new Error("riskLevel must be LOW, MEDIUM, or HIGH.");
}
