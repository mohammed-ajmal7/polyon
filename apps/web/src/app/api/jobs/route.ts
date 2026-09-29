import { isAuthenticated } from "@/server/auth";
import { getPolyonActorId, getPolyonComposition } from "@/server/polyon-server";

export const runtime = "nodejs";

const MAX_RESULTS = 100;

export async function GET(request: Request): Promise<Response> {
  if (!(await isAuthenticated())) {
    return Response.json({ error: "Authentication required." }, { status: 401 });
  }

  const url = new URL(request.url);
  const status = url.searchParams.get("status");
  const allowedStatuses = new Set(["queued", "running", "completed", "failed", "cancelled"]);
  if (status !== null && !allowedStatuses.has(status)) {
    return Response.json({ error: "Invalid job status." }, { status: 400 });
  }

  const limit = parseLimit(url.searchParams.get("limit"));
  const jobs = getPolyonComposition()
    .jobs.list(status as "queued" | "running" | "completed" | "failed" | "cancelled" | undefined)
    .filter((job) => job.userId === getPolyonActorId())
    .slice(0, limit);

  return Response.json({ jobs });
}

function parseLimit(value: string | null): number {
  if (value === null || value.trim() === "") return 50;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > MAX_RESULTS) {
    throw new Error("limit must be between 1 and " + MAX_RESULTS + ".");
  }
  return parsed;
}
