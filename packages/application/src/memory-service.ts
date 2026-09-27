import type { MemoryEntry, MemoryKind, MemoryScope } from "@polyon/contracts";
import type { DomainUnitOfWork, EventStore, MemoryStore } from "@polyon/storage";

export interface RememberMemoryInput {
  readonly id: string;
  readonly kind: MemoryKind;
  readonly scope: MemoryScope;
  readonly text: string;
  readonly tags?: readonly string[];
  readonly sourceIds?: readonly string[];
  readonly missionId?: string;
  readonly taskId?: string;
  readonly now: string;
}

export interface SearchMemoryInput {
  readonly query: string;
  readonly scope?: MemoryScope;
  readonly missionId?: string;
  readonly taskId?: string;
  readonly tags?: readonly string[];
  readonly limit?: number;
}

export class MemoryService {
  constructor(
    private readonly memories: MemoryStore,
    private readonly events: EventStore,
    private readonly unitOfWork?: DomainUnitOfWork,
  ) {}

  remember(input: RememberMemoryInput): MemoryEntry {
    const normalized = normalizeRememberInput(input);
    const operation = () => {
      if (this.memories.get(normalized.id) !== undefined) {
        throw new Error(`Memory already exists: ${normalized.id}.`);
      }

      const entry: MemoryEntry = {
        id: normalized.id,
        kind: normalized.kind,
        scope: normalized.scope,
        text: normalized.text,
        tags: normalized.tags,
        ...(normalized.sourceIds === undefined ? {} : { sourceIds: normalized.sourceIds }),
        ...(normalized.missionId === undefined ? {} : { missionId: normalized.missionId }),
        ...(normalized.taskId === undefined ? {} : { taskId: normalized.taskId }),
        createdAt: normalized.now,
        updatedAt: normalized.now,
      };

      this.memories.save(entry);
      this.events.append({
        id: `MEMORY_RECORDED:${entry.id}`,
        kind: "MEMORY_RECORDED",
        missionId: entry.missionId,
        taskId: entry.taskId,
        occurredAt: entry.createdAt,
        data: {
          memoryId: entry.id,
          kind: entry.kind,
          scope: entry.scope,
          tags: entry.tags,
        },
      });
      return entry;
    };

    return this.unitOfWork === undefined ? operation() : this.unitOfWork.transaction(() => operation());
  }

  search(input: SearchMemoryInput): readonly MemoryEntry[] {
    const queryTokens = tokenize(input.query);
    const requestedTags = new Set((input.tags ?? []).map(normalizeToken).filter(Boolean));
    const limit = input.limit ?? 20;

    if (!Number.isInteger(limit) || limit <= 0 || limit > 100) {
      throw new RangeError("Memory search limit must be an integer between 1 and 100.");
    }

    const ranked = this.memories
      .list()
      .filter((entry) => input.scope === undefined || entry.scope === input.scope)
      .filter((entry) => input.missionId === undefined || entry.missionId === input.missionId)
      .filter((entry) => input.taskId === undefined || entry.taskId === input.taskId)
      .map((entry) => {
        const tokens = new Set([...tokenize(entry.text), ...entry.tags.map(normalizeToken)]);
        const overlap = queryTokens.filter((token) => tokens.has(token)).length;
        const tagBoost = [...requestedTags].filter((tag) => entry.tags.map(normalizeToken).includes(tag)).length;
        const normalizedQuery = normalizeSearchText(input.query);
        const phraseBoost =
          normalizedQuery !== "" && normalizeSearchText(entry.text).includes(normalizedQuery) ? 2 : 0;
        return { entry, score: overlap + tagBoost * 2 + phraseBoost };
      })
      .filter((item) => item.score > 0 || queryTokens.length === 0)
      .sort(
        (a, b) =>
          b.score - a.score ||
          b.entry.updatedAt.localeCompare(a.entry.updatedAt) ||
          a.entry.id.localeCompare(b.entry.id),
      );

    return ranked.slice(0, limit).map((item) => item.entry);
  }
}

function normalizeRememberInput(
  input: RememberMemoryInput,
): RememberMemoryInput & { readonly tags: readonly string[] } {
  const text = input.text.trim();
  if (text === "") throw new RangeError("Memory text must not be empty.");
  if (text.length > 50_000) throw new RangeError("Memory text exceeds the 50000-character limit.");
  const tags = [...new Set((input.tags ?? []).map((tag) => tag.trim()).filter(Boolean))];
  if (tags.length > 32) throw new RangeError("Memory entries may contain at most 32 tags.");
  return { ...input, text, tags };
}

function normalizeSearchText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/gu, " ");
}

function normalizeToken(value: string): string {
  return value.trim().toLowerCase();
}

function tokenize(value: string): string[] {
  return normalizeSearchText(value)
    .split(/[^\p{L}\p{N}]+/gu)
    .filter((token) => token.length >= 2);
}
