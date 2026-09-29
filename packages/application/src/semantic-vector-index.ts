import type { MemoryEmbedding } from "@polyon/contracts";

export interface SemanticVectorSearchHit {
  readonly embedding: MemoryEmbedding;
  readonly score: number;
}

export interface SemanticVectorIndex {
  upsert(embedding: MemoryEmbedding): void;
  remove(embeddingId: MemoryEmbedding["id"]): void;
  rebuild(embeddings: readonly MemoryEmbedding[]): void;
  search(modelId: string, queryVector: readonly number[]): readonly SemanticVectorSearchHit[];
}

interface IndexedEmbedding {
  readonly embedding: MemoryEmbedding;
  readonly normalizedVector: readonly number[];
}

export class ExactNormalizedSemanticVectorIndex implements SemanticVectorIndex {
  private readonly entries = new Map<string, IndexedEmbedding>();
  private readonly buckets = new Map<string, Set<string>>();

  upsert(embedding: MemoryEmbedding): void {
    const normalizedVector = normalize(embedding.vector);
    if (normalizedVector === undefined) {
      this.remove(embedding.id);
      return;
    }

    const existing = this.entries.get(embedding.id);
    if (existing !== undefined) {
      this.removeFromBucket(bucketKey(existing.embedding.modelId, existing.normalizedVector.length), embedding.id);
    }

    this.entries.set(embedding.id, { embedding, normalizedVector });
    const key = bucketKey(embedding.modelId, normalizedVector.length);
    const bucket = this.buckets.get(key) ?? new Set<string>();
    bucket.add(embedding.id);
    this.buckets.set(key, bucket);
  }

  remove(embeddingId: MemoryEmbedding["id"]): void {
    const existing = this.entries.get(embeddingId);
    if (existing === undefined) return;

    this.entries.delete(embeddingId);
    this.removeFromBucket(
      bucketKey(existing.embedding.modelId, existing.normalizedVector.length),
      embeddingId,
    );
  }

  rebuild(embeddings: readonly MemoryEmbedding[]): void {
    this.entries.clear();
    this.buckets.clear();
    for (const embedding of embeddings) this.upsert(embedding);
  }

  search(modelId: string, queryVector: readonly number[]): readonly SemanticVectorSearchHit[] {
    const normalizedQuery = normalize(queryVector);
    if (normalizedQuery === undefined) return [];

    const candidateIds = this.buckets.get(bucketKey(modelId, normalizedQuery.length));
    if (candidateIds === undefined) return [];

    const hits: SemanticVectorSearchHit[] = [];

    for (const id of candidateIds) {
      const entry = this.entries.get(id);
      if (entry === undefined) continue;
      if (entry.embedding.modelId !== modelId) continue;
      if (entry.embedding.dimensions !== normalizedQuery.length) continue;
      if (entry.normalizedVector.length !== normalizedQuery.length) continue;

      hits.push({
        embedding: entry.embedding,
        score: dot(normalizedQuery, entry.normalizedVector),
      });
    }

    return hits;
  }

  private removeFromBucket(key: string, embeddingId: string): void {
    const bucket = this.buckets.get(key);
    if (bucket === undefined) return;

    bucket.delete(embeddingId);
    if (bucket.size === 0) this.buckets.delete(key);
  }
}

function bucketKey(modelId: string, dimensions: number): string {
  return modelId + "\0" + dimensions;
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
