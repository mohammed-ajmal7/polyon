import { beforeEach, describe, expect, it, vi } from "vitest";

const isAuthenticated = vi.fn<() => Promise<boolean>>();
const executionEnabled = vi.fn<() => boolean>();
const getPolyonComposition = vi.fn();

vi.mock("@/server/auth", () => ({
  isAuthenticated,
}));

vi.mock("@/server/polyon-server", () => ({
  executionEnabled,
  getPolyonComposition,
}));

import { GET } from "./route";

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.POLYON_API_TOKEN;
  executionEnabled.mockReturnValue(false);
  isAuthenticated.mockResolvedValue(true);
});

describe("readiness endpoint", () => {
  it("rejects unauthenticated requests", async () => {
    isAuthenticated.mockResolvedValue(false);

    const response = await GET();

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: "Authentication required.",
    });
    expect(getPolyonComposition).not.toHaveBeenCalled();
  });

  it("returns ready when the runtime is running", async () => {
    getPolyonComposition.mockReturnValue({
      agents: {
        list: () => [
          { status: "ACTIVE", preferredModelId: "model-1" },
        ],
      },
      integrations: {
        list: () => [{ kind: "EMAIL" }],
      },
      research: {},
      runtime: {
        health: { status: "RUNNING" },
      },
    });

    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      status: "ready",
      checks: {
        storage: true,
        runtime: true,
        modelConfigured: true,
        emailConfigured: true,
        researchConfigured: true,
        executionEnabled: false,
        authenticationEnabled: false,
      },
    });
  });

  it("requires a configured model when execution is enabled", async () => {
    process.env.POLYON_API_TOKEN = "configured-token";
    executionEnabled.mockReturnValue(true);
    getPolyonComposition.mockReturnValue({
      agents: { list: () => [] },
      integrations: { list: () => [] },
      research: undefined,
      runtime: { health: { status: "RUNNING" } },
    });

    const response = await GET();

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      status: "not_ready",
      checks: {
        storage: true,
        runtime: true,
        modelConfigured: false,
        executionEnabled: true,
        authenticationEnabled: true,
      },
    });
  });

  it("fails closed when composition initialization fails", async () => {
    getPolyonComposition.mockImplementation(() => {
      throw new Error("invalid configuration");
    });

    const response = await GET();

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      status: "not_ready",
      checks: {
        storage: false,
        runtime: false,
        modelConfigured: false,
        emailConfigured: false,
        researchConfigured: false,
        executionEnabled: false,
        authenticationEnabled: false,
      },
    });
  });
});
