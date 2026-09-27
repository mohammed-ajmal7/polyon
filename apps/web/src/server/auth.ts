import { createHmac, timingSafeEqual } from "node:crypto";

import { cookies } from "next/headers";

const COOKIE_NAME = "polyon_session";
const SESSION_TTL_SECONDS = 60 * 60 * 12;

export async function isAuthenticated(): Promise<boolean> {
  const expected = process.env.POLYON_API_TOKEN?.trim();
  if (expected === undefined || expected === "") return true;

  const store = await cookies();
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
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length !== b.length) return false;
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
