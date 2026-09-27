import { isAuthenticated } from "@/server/auth";
import { getPolyonActorId, getPolyonComposition, getPolyonPolicy, isSameOrigin, executionEnabled } from "@/server/polyon-server";

export const runtime = "nodejs";
const MAX_REQUEST_BYTES = 65_536;

export async function POST(request: Request): Promise<Response> {
  if (!(await isAuthenticated())) return Response.json({ error: "Authentication required." }, { status: 401 });
  if (!isSameOrigin(request)) return Response.json({ error: "Cross-origin POST requests are not allowed." }, { status: 403 });
  if (!executionEnabled()) return Response.json({ error: "Execution is disabled. Set POLYON_EXECUTION_ENABLED=true." }, { status: 503 });

  try {
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > MAX_REQUEST_BYTES) {
      return Response.json({ error: "Coding request exceeds the 65536-byte limit." }, { status: 413 });
    }

    const input = JSON.parse(raw) as Record<string, unknown>;
    const requestText = boundedString(input.request, 50_000, "request");
    const requiredCapabilityIds = boundedArray(input.requiredCapabilityIds, 20);
    const agentId = boundedString(input.agentId, 200, "agentId");
    const policy = getPolyonPolicy();

    const result = await getPolyonComposition().codingAgent.invoke({
      agentId,
      requiredCapabilityIds,
      request: {
        messages: [{ role: "USER", content: requestText }],
      },
      policy,
      actorId: getPolyonActorId(),
      missionId: optional(input.missionId),
      taskId: optional(input.taskId),
      executionId: optional(input.executionId),
      maxToolRounds: boundedInteger(input.maxToolRounds, 8, 100),
      maxToolOutputBytes: boundedInteger(input.maxToolOutputBytes, 64 * 1024, 2 * 1024 * 1024),
      ...(Array.isArray(input.allowedToolIds) ? { allowedToolIds: input.allowedToolIds as string[] } : {}),
    });

    return Response.json({ result }, { status: 201 });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Coding execution failed." },
      { status: 400 },
    );
  }
}

function optional(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

function boundedString(value: unknown, maxLength: number, field: string): string {
  if (typeof value !== "string" || value.trim() === "") throw new Error(field + " must be a non-empty string.");
  if (Array.from(value).length > maxLength) throw new Error(field + " exceeds its bound.");
  return value.trim();
}

function boundedArray(value: unknown, maxLength: number): readonly string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > maxLength || value.some((item) => typeof item !== "string")) {
    throw new Error("requiredCapabilityIds must be an array of bounded strings.");
  }
  return value.map((item) => boundedString(item, 200, "capabilityId"));
}

function boundedInteger(value: unknown, fallback: number, max: number): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > max) throw new Error("Integer parameter is outside its allowed bound.");
  return parsed;
}
