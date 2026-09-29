import { isAuthenticated } from "@/server/auth";
import { getPolyonActorId, getPolyonComposition } from "@/server/polyon-server";

export const runtime = "nodejs";

const MAX_RUNS = 100;

export async function GET(request: Request): Promise<Response> {
  if (!(await isAuthenticated())) {
    return Response.json({ error: "Authentication required." }, { status: 401 });
  }

  const url = new URL(request.url);
  const limit = parseLimit(url.searchParams.get("limit"));
  const polyon = getPolyonComposition();
  const runs = polyon.agentRuns
    .listByUser(getPolyonActorId())
    .slice(-limit)
    .reverse();

  return Response.json({ runs });
}

function parseLimit(value: string | null): number {
  if (value === null || value.trim() === "") return 25;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > MAX_RUNS) {
    throw new Error(`limit must be between 1 and ${MAX_RUNS}.`);
  }
  return parsed;
}
