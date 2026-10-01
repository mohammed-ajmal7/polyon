import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import { cookies } from "next/headers";

const COOKIE_NAME = "polyon_session";
const SESSION_TTL_SECONDS = 60 * 60 * 12;

export async function isAuthenticated(): Promise<boolean> {
  // Read request cookies before any configuration check so that pages guarded by this
  // function always render per request. Returning early made Next.js prerender them at
  // build time, when no token is configured, which served them without authentication.
  const store = await cookies();
  const expected = process.env.POLYON_API_TOKEN?.trim();
  if (expected === undefined || expected === "") return true;

  const session = store.get(COOKIE_NAME)?.value;
  return session === undefined ? false : verifySession(session, expected);
}

export async function clearSession(): Promise<void> {
  const store = await cookies();
  store.delete(COOKIE_NAME);
}

export async function issueSession(token: string): Promise<boolean> {
  const expected = process.env.POLYON_API_TOKEN?.trim();
  if (expected === undefined || expected === "") return true;
  if (!safeEqual(token, expected)) return false;

  const store = await cookies();
  store.set(COOKIE_NAME, createSession(expected), {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
  return true;
}

function safeEqual(left: string, right: string): boolean {
  // Compare fixed-length digests so the comparison time does not reveal the secret length.
  const a = Buffer.from(createHash("sha256").update(left).digest("hex"));
  const b = Buffer.from(createHash("sha256").update(right).digest("hex"));
  return timingSafeEqual(a, b);
}

function createSession(secret: string): string {
  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
  const payload = String(expiresAt);
  const signature = createHmac("sha256", secret).update(payload).digest("base64url");
  return payload + "." + signature;
}

function verifySession(value: string, secret: string): boolean {
  const separator = value.indexOf(".");
  if (separator <= 0 || separator === value.length - 1) return false;
  const payload = value.slice(0, separator);
  const signature = value.slice(separator + 1);
  const expiresAt = Number(payload);
  if (!Number.isInteger(expiresAt) || expiresAt <= Math.floor(Date.now() / 1000)) return false;
  const expected = createHmac("sha256", secret).update(payload).digest("base64url");
  return safeEqual(signature, expected);
}

export async function authenticateRequest(request: Request): Promise<boolean> {
  const configured = process.env.POLYON_API_TOKEN?.trim();
  if (configured === undefined || configured === "") return true;

  const authorization = request.headers.get("authorization");
  if (authorization !== null && authorization.startsWith("Bearer ")) {
    const token = authorization.slice("Bearer ".length).trim();
    if (safeEqual(token, configured)) return true;
  }

  return isAuthenticated();
}
