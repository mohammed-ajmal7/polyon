import { randomUUID } from "node:crypto";

import { isAuthenticated } from "@/server/auth";
import {
  executionEnabled,
  getPolyonActorId,
  getPolyonComposition,
  isSameOrigin,
} from "@/server/polyon-server";

export const runtime = "nodejs";
const MAX_REQUEST_BYTES = 32_768;

export async function POST(request: Request): Promise<Response> {
  if (!(await isAuthenticated()))
    return Response.json({ error: "Authentication required." }, { status: 401 });
  if (!isSameOrigin(request))
    return Response.json({ error: "Cross-origin POST requests are not allowed." }, { status: 403 });
  if (!executionEnabled())
    return Response.json(
      { error: "Execution is disabled. Set POLYON_EXECUTION_ENABLED=true." },
      { status: 503 },
    );

  try {
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > MAX_REQUEST_BYTES) {
      return Response.json(
        { error: "Research request exceeds the 32768-byte limit." },
        { status: 413 },
      );
    }

    const input = JSON.parse(raw) as Record<string, unknown>;
    const query = boundedString(input.query, 10_000, "query");
    const sourceLimit = boundedInteger(input.sourceLimit, 5, 20);
    const missionId = optional(input.missionId);
    const taskId = optional(input.taskId);
    const agentId = optional(input.agentId);
    const polyon = getPolyonComposition();

    if (polyon.research === undefined) {
      return Response.json(
        {
          error:
            "Research is not configured. Set a bounded research search endpoint and host allowlist.",
        },
        { status: 503 },
      );
    }

    const actorId = getPolyonActorId();
    const now = new Date().toISOString();
    const research = await polyon.research.conduct({
      query,
      sourceLimit,
      actorId,
      missionId,
      taskId,
      sourceIdFactory: () => "source-" + randomUUID(),
      evidenceIdFactory: () => "evidence-" + randomUUID(),
      now,
    });

    let synthesis: unknown;
    if (input.synthesize === true) {
      const selectedAgentId = agentId ?? polyon.agents.list()[0]?.id;
      if (selectedAgentId === undefined)
        throw new Error("No active agent is configured for research synthesis.");
      synthesis = await polyon.researchSynthesis.synthesize({
        query,
        agentId: selectedAgentId,
        requiredCapabilityIds: [],
        memoryId: "research-summary-" + randomUUID(),
        missionId,
        taskId,
        now: new Date().toISOString(),
      });
    }

    return Response.json({ research, synthesis }, { status: 201 });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Research request failed." },
      { status: 400 },
    );
  }
}

function optional(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

function boundedString(value: unknown, maxLength: number, field: string): string {
  if (typeof value !== "string" || value.trim() === "")
    throw new Error(field + " must be a non-empty string.");
  if (Array.from(value).length > maxLength) throw new Error(field + " exceeds its bound.");
  return value.trim();
}

function boundedInteger(value: unknown, fallback: number, max: number): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > max)
    throw new Error("Integer parameter is outside its allowed bound.");
  return parsed;
}
