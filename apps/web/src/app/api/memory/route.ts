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
