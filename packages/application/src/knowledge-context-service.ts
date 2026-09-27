import type {
  Evidence,
  MemoryEntry,
  MemoryScope,
  Source,
} from "@polyon/contracts";

import type {
  EvidenceStore,
  MemoryStore,
  SourceStore,
} from "@polyon/storage";

export interface KnowledgeContextInput {
  readonly query: string;
  readonly allowedScopes: readonly MemoryScope[];
  readonly missionId?: string;
  readonly taskId?: string;
  readonly tags?: readonly string[];
  readonly memoryLimit?: number;
  readonly evidenceLimit?: number;
  readonly maxCharacters?: number;
  readonly includeEvidence?: boolean;
}

export interface KnowledgeContextItem {
  readonly kind: "MEMORY" | "EVIDENCE";
  readonly id: string;
  readonly text: string;
  readonly sourceId?: string;
  readonly memoryId?: string;
  readonly score: number;
}

export interface KnowledgeContextResult {
  readonly query: string;
  readonly text: string;
  readonly items: readonly KnowledgeContextItem[];
  readonly sources: readonly Source[];
}

export class KnowledgeContextService {
  constructor(
    private readonly memories: MemoryStore,
    private readonly evidence: EvidenceStore,
    private readonly sources: SourceStore,
  ) {}

  assemble(input: KnowledgeContextInput): KnowledgeContextResult {
    const query = input.query.trim();
    if (query === "") throw new RangeError("Knowledge context query must not be empty.");
    if (input.allowedScopes.length === 0) {
      throw new RangeError("Knowledge context requires at least one allowed memory scope.");
    }

    const maxCharacters = input.maxCharacters ?? 30_000;
    const memoryLimit = input.memoryLimit ?? 20;
    const evidenceLimit = input.evidenceLimit ?? 30;
    assertBound(maxCharacters, 1, 100_000, "maxCharacters");
    assertBound(memoryLimit, 1, 100, "memoryLimit");
    assertBound(evidenceLimit, 1, 100, "evidenceLimit");

    const normalizedQuery = normalize(query);
    const queryTokens = tokenize(query);
    const allowedScopes = new Set(input.allowedScopes);

    const memoryItems = this.memories
      .list()
      .filter((memory) => allowedScopes.has(memory.scope))
      .filter((memory) => input.missionId === undefined || memory.missionId === input.missionId)
      .filter((memory) => input.taskId === undefined || memory.taskId === input.taskId)
      .map((memory) => ({
        entry: memory,
        score: scoreText(queryTokens, normalizedQuery, memory.text, memory.tags),
      }))
      .filter((item) => item.score > 0)
      .sort(compareMemory)
      .slice(0, memoryLimit);

    const evidenceItems = input.includeEvidence === false
      ? []
      : this.evidence
          .list()
          .filter((item) => input.missionId === undefined || item.missionId === input.missionId)
          .filter((item) => input.taskId === undefined || item.taskId === input.taskId)
          .map((item) => ({
            entry: item,
            score: scoreText(queryTokens, normalizedQuery, item.claim, []),
          }))
          .filter((item) => item.score > 0)
          .sort(compareEvidence)
          .slice(0, evidenceLimit);

    const items: KnowledgeContextItem[] = [];
    const sourceIds = new Set<string>();
    let usedCharacters = 0;

    for (const item of memoryItems) {
      const text = formatMemory(item.entry);
      if (!appendWithinBudget(items, {
        kind: "MEMORY",
        id: item.entry.id,
        text,
        memoryId: item.entry.id,
        score: item.score,
      }, maxCharacters, usedCharacters)) {
        break;
      }
      usedCharacters += text.length + 1;
      for (const sourceId of item.entry.sourceIds ?? []) sourceIds.add(sourceId);
    }

    for (const item of evidenceItems) {
      const source = this.sources.get(item.entry.sourceId);
      const text = formatEvidence(item.entry, source);
      if (!appendWithinBudget(items, {
        kind: "EVIDENCE",
        id: item.entry.id,
        text,
        sourceId: item.entry.sourceId,
        score: item.score,
      }, maxCharacters, usedCharacters)) {
        continue;
      }
      usedCharacters += text.length + 1;
      sourceIds.add(item.entry.sourceId);
    }

    return {
      query,
      text: items.map((item) => item.text).join("\n"),
      items,
      sources: [...sourceIds]
        .map((id) => this.sources.get(id))
        .filter((source): source is Source => source !== undefined),
    };
  }
}

function appendWithinBudget(
  items: KnowledgeContextItem[],
  item: KnowledgeContextItem,
  maxCharacters: number,
  usedCharacters: number,
): boolean {
  if (usedCharacters + item.text.length + 1 > maxCharacters) return false;
  items.push(item);
  return true;
}

function formatMemory(memory: MemoryEntry): string {
  const sources = memory.sourceIds === undefined ? "" : ` [sources:${memory.sourceIds.join(",")}]`;
  return `[memory:${memory.id} scope:${memory.scope}]${sources} ${memory.text}`;
}

function formatEvidence(evidence: Evidence, source: Source | undefined): string {
  return `[evidence:${evidence.id} source:${evidence.sourceId} ${source?.title ?? "unknown"}]` +
    ` ${evidence.kind}: ${evidence.claim}\n${evidence.supportingContent}`;
}

function scoreText(
  queryTokens: readonly string[],
  normalizedQuery: string,
  text: string,
  tags: readonly string[],
): number {
  const normalizedText = normalize(text);
  const tokenSet = new Set([...tokenize(text), ...tags.map(normalize)]);
  let score = 0;
  for (const token of queryTokens) if (tokenSet.has(token)) score += 1;
  if (normalizedQuery !== "" && normalizedText.includes(normalizedQuery)) score += 3;
  return score;
}

function compareMemory(
  left: { entry: MemoryEntry; score: number },
  right: { entry: MemoryEntry; score: number },
): number {
  return right.score - left.score ||
    right.entry.updatedAt.localeCompare(left.entry.updatedAt) ||
    left.entry.id.localeCompare(right.entry.id);
}

function compareEvidence(
  left: { entry: Evidence; score: number },
  right: { entry: Evidence; score: number },
): number {
  return right.score - left.score ||
    right.entry.capturedAt.localeCompare(left.entry.capturedAt) ||
    left.entry.id.localeCompare(right.entry.id);
}

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/gu, " ");
}

function tokenize(value: string): string[] {
  return normalize(value)
    .split(/[^\p{L}\p{N}]+/gu)
    .filter((token) => token.length >= 2);
}

function assertBound(
  value: number,
  minimum: number,
  maximum: number,
  field: string,
): void {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(`${field} must be an integer between ${minimum} and ${maximum}.`);
  }
}
