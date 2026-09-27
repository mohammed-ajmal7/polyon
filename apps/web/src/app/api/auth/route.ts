import { isAuthenticated, issueSession } from "@/server/auth";

export const runtime = "nodejs";
const MAX_AUTH_REQUEST_BYTES = 8_192;

export async function GET(): Promise<Response> {
  return Response.json({
    enabled:
      (process.env.POLYON_API_TOKEN?.trim() ?? "") !== "",
    authenticated: await isAuthenticated(),
  });
}

export async function POST(request: Request): Promise<Response> {
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > MAX_AUTH_REQUEST_BYTES) {
    return Response.json({ error: "Authentication request exceeds the 8192-byte limit." }, { status: 413 });
  }
  const input = (JSON.parse(raw) as Record<string, unknown>) ?? {};
  const token = typeof input.token === "string" ? input.token : "";
  if (!(await issueSession(token))) {
    return Response.json({ error: "Invalid POLYON API token." }, { status: 401 });
  }
  return Response.json({ authenticated: true });
}
