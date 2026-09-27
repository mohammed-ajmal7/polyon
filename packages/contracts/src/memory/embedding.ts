import type { MemoryId } from "./ids";

export interface MemoryEmbedding {
  readonly id: string;
  readonly memoryId: MemoryId;
  readonly modelId: string;
  readonly dimensions: number;
  readonly vector: readonly number[];
  readonly contentHash: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}
