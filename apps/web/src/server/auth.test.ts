import { afterEach, describe, expect, it, vi } from "vitest";

const cookieStore = {
  get: vi.fn<(name: string) => { value: string } | undefined>(),
  set: vi.fn(),
  delete: vi.fn(),
};

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => cookieStore),
}));

import {
  authenticateRequest,
  issueSession,
  isAuthenticated,
} from "./auth";

afterEach(() => {
  vi.clearAllMocks();
  delete process.env.POLYON_API_TOKEN;
});

describe("web authentication", () => {
  it("accepts a configured bearer token and rejects a forged one", async () => {
    process.env.POLYON_API_TOKEN = "correct-token";

    expect(
      await authenticateRequest(
        new Request("http://localhost:3000/api/mcp", {
          headers: { authorization: "Bearer correct-token" },
        }),
      ),
    ).toBe(true);

    expect(
      await authenticateRequest(
        new Request("http://localhost:3000/api/mcp", {
          headers: { authorization: "Bearer forged-token" },
        }),
      ),
    ).toBe(false);
  });

  it("rejects tampered or expired session values", async () => {
    process.env.POLYON_API_TOKEN = "correct-token";
    cookieStore.get.mockReturnValue({ value: "1.invalid-signature" });
    expect(await isAuthenticated()).toBe(false);

    cookieStore.get.mockReturnValue({ value: "not-a-session" });
    expect(await isAuthenticated()).toBe(false);
  });

  it("issues a signed http-only session cookie", async () => {
    process.env.POLYON_API_TOKEN = "correct-token";
    expect(await issueSession("correct-token")).toBe(true);

    expect(cookieStore.set).toHaveBeenCalledWith(
      "polyon_session",
      expect.stringMatching(/^\d+\.[A-Za-z0-9_-]+$/),
      expect.objectContaining({
        httpOnly: true,
        sameSite: "strict",
      }),
    );
  });
});
