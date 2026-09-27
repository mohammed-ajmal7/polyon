import { createHash } from "node:crypto";

import type { MemoryEmbedding, MemoryEntry } from "@polyon/contracts";
import type { EmbeddingGateway } from "@polyon/providers";
import type { DomainUnitOfWork, EntityStore, MemoryStore } from "@polyon/storage";

export interface SemanticMemorySearchInput {
  readonly query: string;
  readonly scope?: MemoryEntry["scope"];
  readonly missionId?: string;
  readonly taskId?: string;
  readonly tags?: readonly string[];
  readonly limit?: number;
  readonly modelId: string;
}

export interface SemanticMemorySearchResult {
  readonly memory: MemoryEntry;
  readonly score: number;
}

export class SemanticMemoryService {
  constructor(
    private readonly memories: MemoryStore,
    private readonly embeddings: EntityStore<MemoryEmbedding>,
    private readonly embeddingGateway: EmbeddingGateway,
    private readonly unitOfWork?: DomainUnitOfWork,
  ) {}

  async index(memory: MemoryEntry, modelId: string, now: string): Promise<MemoryEmbedding> {
    const response = await this.embeddingGateway.embed(modelId, { input: [memory.text] });
    const vector = response.vectors[0];

    if (vector === undefined) {
      throw new Error("Embedding provider returned no vector.");
    }

    const embedding: MemoryEmbedding = {
      id: this.embeddingId(memory.id, modelId),
      memoryId: memory.id,
      modelId,
      dimensions: vector.length,
      vector,
      contentHash: this.contentHash(memory.text),
      createdAt: now,
      updatedAt: now,
    };

    const operation = () => {
      if (this.memories.get(memory.id) === undefined) {
        throw new Error(`Memory not found: ${memory.id}.`);
      }
      this.embeddings.save(embedding);
      return embedding;
    };

    return this.unitOfWork === undefined ? operation() : this.unitOfWork.transaction(() => operation());
  }

  async search(input: SemanticMemorySearchInput): Promise<readonly SemanticMemorySearchResult[]> {
    const query = input.query.trim();
    if (query === "") throw new RangeError("Semantic memory query must not be empty.");

    const limit = input.limit ?? 20;
    if (!Number.isInteger(limit) || limit <= 0 || limit > 100) {
      throw new RangeError("Semantic memory search limit must be an integer between 1 and 100.");
    }

    const queryResponse = await this.embeddingGateway.embed(input.modelId, { input: [query] });
    const queryVector = queryResponse.vectors[0];
    if (queryVector === undefined) throw new Error("Embedding provider returned no query vector.");

    const results = this.embeddings
      .list()
      .filter((embedding) => embedding.modelId === input.modelId)
      .filter((embedding) => embedding.dimensions === queryVector.length)
      .map((embedding) => {
        const memory = this.memories.get(embedding.memoryId);
        if (memory === undefined) return undefined;
        if (input.scope !== undefined && memory.scope !== input.scope) return undefined;
        if (input.missionId !== undefined && memory.missionId !== input.missionId) return undefined;
        if (input.taskId !== undefined && memory.taskId !== input.taskId) return undefined;
        if (input.tags !== undefined && !input.tags.every((tag) => memory.tags.some((candidate) => candidate.toLowerCase() === tag.toLowerCase()))) return undefined;
        if (embedding.contentHash !== this.contentHash(memory.text)) return undefined;

        return {
          memory,
          score: cosineSimilarity(queryVector, embedding.vector),
        };
      })
      .filter((result): result is SemanticMemorySearchResult => result !== undefined)
      .sort((left, right) =>
        right.score - left.score ||
        right.memory.updatedAt.localeCompare(left.memory.updatedAt) ||
        left.memory.id.localeCompare(right.memory.id),
      );

    return results.slice(0, limit);
  }

  private embeddingId(memoryId: string, modelId: string): string {
    return createHash("sha256").update(memoryId + "\0" + modelId).digest("hex");
  }

  private contentHash(text: string): string {
    return createHash("sha256").update(text).digest("hex");
  }
}

function cosineSimilarity(left: readonly number[], right: readonly number[]): number {
  if (left.length !== right.length || left.length === 0) return 0;

  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;

  for (let index = 0; index < left.length; index += 1) {
    const leftValue = left[index]!;
    const rightValue = right[index]!;
    dot += leftValue * rightValue;
    leftMagnitude += leftValue * leftValue;
    rightMagnitude += rightValue * rightValue;
  }

  if (leftMagnitude === 0 || rightMagnitude === 0) return 0;
  return dot / Math.sqrt(leftMagnitude * rightMagnitude);
}
