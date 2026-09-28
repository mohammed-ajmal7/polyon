import type { MemoryEmbedding } from "@polyon/contracts";

export interface SemanticVectorSearchHit {
  readonly embedding: MemoryEmbedding;
  readonly score: number;
}

export interface SemanticVectorIndex {
  upsert(embedding: MemoryEmbedding): void;
  remove(embeddingId: MemoryEmbedding["id"]): void;
  rebuild(embeddings: readonly MemoryEmbedding[]): void;
  search(
    modelId: string,
    queryVector: readonly number[],
  ): readonly SemanticVectorSearchHit[];
}

interface IndexedEmbedding {
  readonly embedding: MemoryEmbedding;
  readonly normalizedVector: readonly number[];
}

export class ExactNormalizedSemanticVectorIndex implements SemanticVectorIndex {
  private readonly entries = new Map<string, IndexedEmbedding>();

  upsert(embedding: MemoryEmbedding): void {
    const normalizedVector = normalize(embedding.vector);
    if (normalizedVector === undefined) {
      this.entries.delete(embedding.id);
      return;
    }

    this.entries.set(embedding.id, { embedding, normalizedVector });
  }

  remove(embeddingId: MemoryEmbedding["id"]): void {
    this.entries.delete(embeddingId);
  }

  rebuild(embeddings: readonly MemoryEmbedding[]): void {
    this.entries.clear();
    for (const embedding of embeddings) this.upsert(embedding);
  }

  search(modelId: string, queryVector: readonly number[]): readonly SemanticVectorSearchHit[] {
    const normalizedQuery = normalize(queryVector);
    if (normalizedQuery === undefined) return [];

    const hits: SemanticVectorSearchHit[] = [];
    for (const entry of this.entries.values()) {
      if (entry.embedding.modelId !== modelId) continue;
      if (entry.embedding.dimensions !== normalizedQuery.length) continue;

      hits.push({
        embedding: entry.embedding,
        score: dot(normalizedQuery, entry.normalizedVector),
      });
    }

    return hits;
  }
}

function normalize(vector: readonly number[]): number[] | undefined {
  if (vector.length === 0) return undefined;

  let magnitudeSquared = 0;
  for (const value of vector) {
    if (!Number.isFinite(value)) return undefined;
    magnitudeSquared += value * value;
  }

  if (!Number.isFinite(magnitudeSquared) || magnitudeSquared === 0) return undefined;

  const magnitude = Math.sqrt(magnitudeSquared);
  return vector.map((value) => value / magnitude);
}

function dot(left: readonly number[], right: readonly number[]): number {
  let score = 0;
  for (let index = 0; index < left.length; index += 1) {
    score += left[index]! * right[index]!;
  }
  return score;
}
