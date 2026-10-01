import { TraceQueryService } from "@polyon/application";
import { isAuthenticated } from "@/server/auth";
import { getPolyonComposition } from "@/server/polyon-server";
export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  if (!(await isAuthenticated()))
    return Response.json({ error: "Authentication required." }, { status: 401 });
  const url = new URL(request.url);
  const limit = parseLimit(url.searchParams.get("limit"));
  if (limit === undefined) {
    return Response.json({ error: "limit must be an integer between 1 and 500." }, { status: 400 });
  }
  const result = new TraceQueryService(getPolyonComposition().stores.events).list({
    missionId: optional(url.searchParams.get("missionId")),
    taskId: optional(url.searchParams.get("taskId")),
    executionId: optional(url.searchParams.get("executionId")),
    conversationId: optional(url.searchParams.get("conversationId")),
    limit,
  });
  return Response.json({ events: result });
}

function optional(value: string | null): string | undefined {
  const trimmed = value?.trim() ?? "";
  return trimmed === "" ? undefined : trimmed;
}

function parseLimit(value: string | null): number | undefined {
  if (value === null || value === "") return 100;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 500 ? parsed : undefined;
}
