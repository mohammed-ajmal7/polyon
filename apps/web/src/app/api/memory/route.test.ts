import { beforeEach, describe, expect, it, vi } from "vitest";

const { isAuthenticated, getPolyonComposition } = vi.hoisted(() => ({
  isAuthenticated: vi.fn<() => Promise<boolean>>(),
  getPolyonComposition: vi.fn(),
}));

vi.mock("@/server/auth", () => ({
  isAuthenticated,
}));

vi.mock("@/server/polyon-server", () => ({
  getPolyonComposition,
}));

import { GET } from "./route";

beforeEach(() => {
  vi.clearAllMocks();
  isAuthenticated.mockResolvedValue(true);
});

describe("memory API", () => {
  it("serves bounded semantic search through the composition service", async () => {
    const search = vi.fn(() => [
      {
        memory: {
          id: "memory-1",
          scope: "PROJECT",
          text: "database durability",
        },
        score: 0.99,
      },
    ]);

    getPolyonComposition.mockReturnValue({
      semanticMemory: { search },
      memory: { search: vi.fn() },
    });

    const response = await GET(
      new Request(
        "http://localhost:3000/api/memory?q=database%20durability&mode=semantic&modelId=embedding-model&limit=5",
      ),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      memories: [
        {
          memory: {
            id: "memory-1",
            scope: "PROJECT",
            text: "database durability",
          },
          score: 0.99,
        },
      ],
    });
    expect(search).toHaveBeenCalledWith({
      query: "database durability",
      scope: undefined,
      missionId: undefined,
      taskId: undefined,
      limit: 5,
      modelId: "embedding-model",
    });
  });

  it("returns 503 when semantic search is not configured", async () => {
    getPolyonComposition.mockReturnValue({
      semanticMemory: undefined,
      memory: { search: vi.fn() },
    });

    const response = await GET(
      new Request(
        "http://localhost:3000/api/memory?q=test&mode=semantic",
      ),
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "Semantic memory search is not configured.",
    });
  });

  it("rejects unknown search modes", async () => {
    getPolyonComposition.mockReturnValue({
      semanticMemory: undefined,
      memory: { search: vi.fn() },
    });

    const response = await GET(
      new Request(
        "http://localhost:3000/api/memory?q=test&mode=other",
      ),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "mode must be lexical or semantic.",
    });
  });
});
