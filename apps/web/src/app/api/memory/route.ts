import { isAuthenticated } from "@/server/auth";
import { getPolyonComposition } from "@/server/polyon-server";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  if (!(await isAuthenticated())) return Response.json({ error: "Authentication required." }, { status: 401 });

  const url = new URL(request.url);
  const limit = Number(url.searchParams.get("limit") ?? "50");
  const query = url.searchParams.get("q")?.trim() ?? "";

  if (!Number.isInteger(limit) || limit <= 0 || limit > 100) {
    return Response.json({ error: "limit must be between 1 and 100." }, { status: 400 });
  }

  const polyon = getPolyonComposition();
  const memories = polyon.memory.search({
    query,
    scope: optional(url.searchParams.get("scope")) as never,
    missionId: optional(url.searchParams.get("missionId")),
    taskId: optional(url.searchParams.get("taskId")),
    limit,
  });

  return Response.json({ memories });
}

function optional(value: string | null): string | undefined {
  const trimmed = value?.trim() ?? "";
  return trimmed === "" ? undefined : trimmed;
}


export async function POST(request: Request): Promise<Response> {
  if (!(await isAuthenticated())) return Response.json({ error: "Authentication required." }, { status: 401 });
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  if (origin !== null && (host === null || (() => { try { return new URL(origin).host !== host; } catch { return true; } })())) {
    return Response.json({ error: "Cross-origin POST requests are not allowed." }, { status: 403 });
  }

  try {
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > 65_536) {
      return Response.json({ error: "Memory request exceeds the 65536-byte limit." }, { status: 413 });
    }

    const input = JSON.parse(raw) as Record<string, unknown>;
    const id = boundedString(input.id, 200, "id");
    const kind = parseEnum(input.kind, ["FACT", "PREFERENCE", "DECISION", "SUMMARY", "OTHER"], "kind");
    const scope = parseEnum(input.scope, ["PRIVATE", "PROJECT", "MISSION", "TASK"], "scope");
    const text = boundedString(input.text, 50_000, "text");
    const tags = parseBoundedStrings(input.tags, 32, 100);
    const sourceIds = parseBoundedStrings(input.sourceIds, 100, 200);
    const missionId = optional(input.missionId);
    const taskId = optional(input.taskId);
    const now = new Date().toISOString();
    const result = await getPolyonComposition().toolInvocation.invoke({
      invocationId: "web-memory:" + randomUUID(),
      toolId: "memory.remember",
      input: {
        id,
        kind,
        scope,
        text,
        tags,
        sourceIds,
        missionId,
        taskId,
      },
      action: "WRITE",
      riskLevel: "MEDIUM",
      policy: getPolyonPolicy(),
      decisionId: "web-memory-policy:" + randomUUID(),
      approvalRequestId: "web-memory-approval:" + randomUUID(),
      requestedBy: getPolyonActorId(),
      requestedAt: now,
      evaluatedAt: now,
      actorId: getPolyonActorId(),
      missionId,
      taskId,
    });

    return Response.json({ result }, { status: result.status === "APPROVAL_REQUIRED" ? 202 : 201 });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Memory write failed." },
      { status: 400 },
    );
  }
}

function boundedString(value: unknown, max: number, field: string): string {
  if (typeof value !== "string" || value.trim() === "") throw new Error(field + " must be a non-empty string.");
  if (Array.from(value).length > max) throw new Error(field + " exceeds its bound.");
  return value.trim();
}

function parseEnum<T extends string>(value: unknown, allowed: readonly T[], field: string): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) throw new Error(field + " is invalid.");
  return value as T;
}

function parseBoundedStrings(value: unknown, maxItems: number, maxLength: number): readonly string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > maxItems) throw new Error("Array exceeds its bound.");
  return value.map((item) => boundedString(item, maxLength, "array item"));
}
