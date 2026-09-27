import { isAuthenticated } from "@/server/auth";
import { getPolyonComposition } from "@/server/polyon-server";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  if (!(await isAuthenticated())) {
    return Response.json({ error: "Authentication required." }, { status: 401 });
  }

  const url = new URL(request.url);
  const limit = Number(url.searchParams.get("limit") ?? "50");
  if (!Number.isInteger(limit) || limit <= 0 || limit > 200) {
    return Response.json({ error: "limit must be between 1 and 200." }, { status: 400 });
  }

  return Response.json({
    missions: getPolyonComposition().stores.missions.list().slice(-limit).reverse(),
  });
}
