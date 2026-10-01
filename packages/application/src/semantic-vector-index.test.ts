import { describe, expect, it } from "vitest";

import type { MemoryEmbedding } from "@polyon/contracts";

import { ExactNormalizedSemanticVectorIndex } from "./semantic-vector-index";

const embedding = (id: string, modelId: string, vector: readonly number[]): MemoryEmbedding => ({
  id,
  memoryId: id,
  modelId,
  dimensions: vector.length,
  vector,
  contentHash: "hash-" + id,
  createdAt: "2026-09-28T00:00:00.000Z",
  updatedAt: "2026-09-28T00:00:00.000Z",
});

describe("ExactNormalizedSemanticVectorIndex", () => {
  it("normalizes vectors once and returns exact cosine-equivalent scores", () => {
    const index = new ExactNormalizedSemanticVectorIndex();
    index.rebuild([
      embedding("a", "model", [1, 0]),
      embedding("b", "model", [0, 1]),
      embedding("c", "other-model", [1, 0]),
    ]);

    const hits = index.search("model", [1, 0]);

    expect(hits.map((hit) => hit.embedding.id)).toEqual(["a", "b"]);
    expect(hits[0]?.score).toBeCloseTo(1);
    expect(hits[1]?.score).toBeCloseTo(0);
  });

  it("drops invalid and zero-length vectors instead of indexing them", () => {
    const index = new ExactNormalizedSemanticVectorIndex();
    index.rebuild([
      embedding("valid", "model", [1, 1]),
      embedding("zero", "model", [0, 0]),
      embedding("nan", "model", [Number.NaN, 1]),
    ]);

    expect(index.search("model", [1, 1]).map((hit) => hit.embedding.id)).toEqual(["valid"]);
  });
  it("isolates searches by model and vector dimensions", () => {
    const index = new ExactNormalizedSemanticVectorIndex();
    index.rebuild([
      embedding("model-a-2d", "model-a", [1, 0]),
      embedding("model-a-3d", "model-a", [1, 0, 0]),
      embedding("model-b-2d", "model-b", [1, 0]),
    ]);

    expect(index.search("model-a", [1, 0]).map((hit) => hit.embedding.id)).toEqual(["model-a-2d"]);
  });

  it("keeps bucket membership correct across replacement and removal", () => {
    const index = new ExactNormalizedSemanticVectorIndex();
    index.upsert(embedding("a", "model", [1, 0]));
    index.upsert(embedding("a", "model", [1, 0, 0]));

    expect(index.search("model", [1, 0])).toEqual([]);
    expect(index.search("model", [1, 0, 0]).map((hit) => hit.embedding.id)).toEqual(["a"]);

    index.remove("a");
    expect(index.search("model", [1, 0, 0])).toEqual([]);
  });
});
