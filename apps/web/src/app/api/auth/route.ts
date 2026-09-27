import { isAuthenticated, issueSession } from "@/server/auth";

export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  return Response.json({
    enabled:
      (process.env.POLYON_API_TOKEN?.trim() ?? "") !== "",
    authenticated: await isAuthenticated(),
  });
}

export async function POST(request: Request): Promise<Response> {
  const input = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const token = typeof input.token === "string" ? input.token : "";
  if (!(await issueSession(token))) {
    return Response.json({ error: "Invalid POLYON API token." }, { status: 401 });
  }
  return Response.json({ authenticated: true });
}
