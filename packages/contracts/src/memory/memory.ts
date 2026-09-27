import type { MemoryId } from "./ids";

export type MemoryKind = "FACT" | "PREFERENCE" | "DECISION" | "SUMMARY" | "OTHER";
export type MemoryScope = "PRIVATE" | "PROJECT" | "MISSION" | "TASK";

export interface MemoryEntry {
  readonly id: MemoryId;
  readonly kind: MemoryKind;
  readonly scope: MemoryScope;
  readonly text: string;
  readonly tags: readonly string[];
  readonly sourceIds?: readonly string[];
  readonly missionId?: string;
  readonly taskId?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}
