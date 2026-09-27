import { isAuthenticated } from "@/server/auth";
import { getPolyonComposition } from "@/server/polyon-server";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  if (!(await isAuthenticated())) return Response.json({ error: "Authentication required." }, { status: 401 });

  const url = new URL(request.url);
  const limit = Number(url.searchParams.get("limit") ?? "100");

  if (!Number.isInteger(limit) || limit <= 0 || limit > 500) {
    return Response.json({ error: "limit must be between 1 and 500." }, { status: 400 });
  }

  return Response.json({
    sources: getPolyonComposition().stores.sources.list().slice(-limit),
  });
}
