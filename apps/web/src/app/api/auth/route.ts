import { isAuthenticated, issueSession, clearSession } from "@/server/auth";
import { isSameOrigin } from "@/server/polyon-server";
import { readBoundedText } from "@/server/bounded-body";

export const runtime = "nodejs";
const MAX_AUTH_REQUEST_BYTES = 8_192;

export async function GET(): Promise<Response> {
  return Response.json({
    enabled: (process.env.POLYON_API_TOKEN?.trim() ?? "") !== "",
    authenticated: await isAuthenticated(),
  });
}

export async function POST(request: Request): Promise<Response> {
  if (!isSameOrigin(request)) {
    return Response.json(
      { error: "Cross-origin authentication requests are not allowed." },
      { status: 403 },
    );
  }
  const raw = await readBoundedText(request, MAX_AUTH_REQUEST_BYTES);
  if (raw === undefined) {
    return Response.json(
      { error: "Authentication request exceeds the 8192-byte limit." },
      { status: 413 },
    );
  }
  let input: unknown;
  try {
    input = JSON.parse(raw);
  } catch {
    return Response.json({ error: "Invalid JSON payload." }, { status: 400 });
  }
  const token =
    typeof input === "object" &&
    input !== null &&
    typeof (input as Record<string, unknown>).token === "string"
      ? ((input as Record<string, unknown>).token as string)
      : "";
  if (!(await issueSession(token))) {
    return Response.json({ error: "Invalid POLYON API token." }, { status: 401 });
  }
  return Response.json({ authenticated: true });
}

export async function DELETE(request: Request): Promise<Response> {
  if (!isSameOrigin(request)) {
    return Response.json(
      { error: "Cross-origin authentication requests are not allowed." },
      { status: 403 },
    );
  }
  await clearSession();
  return Response.json({ authenticated: false });
}
