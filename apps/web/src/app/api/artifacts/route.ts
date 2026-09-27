import { isAuthenticated } from "@/server/auth";
import { getPolyonComposition } from "@/server/polyon-server";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  if (!(await isAuthenticated())) return Response.json({ error: "Authentication required." }, { status: 401 });

  const url = new URL(request.url);
  const missionId = optional(url.searchParams.get("missionId"));
  const taskId = optional(url.searchParams.get("taskId"));
  const limit = Number(url.searchParams.get("limit") ?? "100");

  if (!Number.isInteger(limit) || limit <= 0 || limit > 500) {
    return Response.json({ error: "limit must be between 1 and 500." }, { status: 400 });
  }

  const items = getPolyonComposition().stores.artifacts
    .list()
    .filter((item) => missionId === undefined || item.missionId === missionId)
    .filter((item) => taskId === undefined || item.taskId === taskId)
    .slice(-limit);

  return Response.json({ artifacts: items });
}

function optional(value: string | null): string | undefined {
  const trimmed = value?.trim() ?? "";
  return trimmed === "" ? undefined : trimmed;
}
