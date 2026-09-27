import { timingSafeEqual } from "node:crypto";

import { cookies } from "next/headers";

const COOKIE_NAME = "polyon_session";

export async function isAuthenticated(): Promise<boolean> {
  const expected = process.env.POLYON_API_TOKEN?.trim();
  if (expected === undefined || expected === "") return true;

  const store = await cookies();
  const session = store.get(COOKIE_NAME)?.value;
  return session === undefined ? false : safeEqual(session, expected);
}

export async function issueSession(token: string): Promise<boolean> {
  const expected = process.env.POLYON_API_TOKEN?.trim();
  if (expected === undefined || expected === "") return true;
  if (!safeEqual(token, expected)) return false;

  const store = await cookies();
  store.set(COOKIE_NAME, expected, {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 12,
  });
  return true;
}

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
