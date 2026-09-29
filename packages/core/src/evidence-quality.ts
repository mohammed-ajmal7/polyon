import type { Evidence, Source, SourceKind } from "@polyon/contracts";

export interface EvidenceQualitySignals {
  readonly authority: number;
  readonly directness: number;
  readonly recency: number;
  readonly independence: number;
  readonly corroboration: number;
  readonly specificity: number;
  readonly contradictionPenalty: number;
}

export interface EvidenceQuality extends EvidenceQualitySignals {
  readonly score: number;
}

const QUALITY_WEIGHTS = {
  authority: 0.18,
  directness: 0.18,
  recency: 0.14,
  independence: 0.14,
  corroboration: 0.14,
  specificity: 0.22,
} as const;

export function scoreEvidenceQuality(signals: EvidenceQualitySignals): EvidenceQuality {
  assertUnitInterval(signals.authority, "authority");
  assertUnitInterval(signals.directness, "directness");
  assertUnitInterval(signals.recency, "recency");
  assertUnitInterval(signals.independence, "independence");
  assertUnitInterval(signals.corroboration, "corroboration");
  assertUnitInterval(signals.specificity, "specificity");
  assertUnitInterval(signals.contradictionPenalty, "contradictionPenalty");

  const positiveScore =
    signals.authority * QUALITY_WEIGHTS.authority +
    signals.directness * QUALITY_WEIGHTS.directness +
    signals.recency * QUALITY_WEIGHTS.recency +
    signals.independence * QUALITY_WEIGHTS.independence +
    signals.corroboration * QUALITY_WEIGHTS.corroboration +
    signals.specificity * QUALITY_WEIGHTS.specificity;

  return {
    ...signals,
    score: Number((positiveScore * (1 - signals.contradictionPenalty)).toFixed(6)),
  };
}

export function baselineSourceAuthority(kind: SourceKind): number {
  switch (kind) {
    case "DATABASE":
    case "API":
      return 0.9;
    case "DOCUMENT":
      return 0.8;
    case "WEB":
      return 0.65;
    case "FILE":
      return 0.6;
    case "MESSAGE":
      return 0.5;
    case "USER_PROVIDED":
      return 0.45;
    case "AGENT_GENERATED":
      return 0.25;
    case "OTHER":
      return 0.4;
  }
}

export interface EvidenceQualityContext {
  readonly evidence: readonly Evidence[];
  readonly sources: ReadonlyMap<string, Source>;
  readonly now: string;
}

export function buildEvidenceQuality(
  item: Evidence,
  context: EvidenceQualityContext,
): EvidenceQuality {
  const source = context.sources.get(item.sourceId);
  const claimTokens = tokenize(item.claim);
  const supportTokens = new Set(tokenize(item.supportingContent));
  const directness =
    claimTokens.length === 0
      ? 0
      : claimTokens.filter((token) => supportTokens.has(token)).length / claimTokens.length;

  const specificity = Math.min(
    1,
    (new Set(claimTokens).size / 12) * 0.7 +
      (item.supportingContent.trim().length >= 120 ? 0.3 : item.supportingContent.trim().length / 400),
  );

  const related = context.evidence.filter(
    (candidate) =>
      candidate.id !== item.id && normalize(candidate.claim) === normalize(item.claim),
  );
  const relatedSourceIds = new Set(related.map((candidate) => candidate.sourceId));
  const corroboration = Math.min(1, relatedSourceIds.size / 3);

  const contradictory = related.filter((candidate) => candidate.kind === "CONTRADICTING");
  const contradictorySourceIds = new Set(contradictory.map((candidate) => candidate.sourceId));
  const contradictionPenalty = Math.min(1, contradictorySourceIds.size / 3);

  const distinctRelatedSources = new Set(
    context.evidence
      .filter((candidate) => normalize(candidate.claim) === normalize(item.claim))
      .map((candidate) => candidate.sourceId),
  );
  const independence = distinctRelatedSources.size <= 1 ? 1 : Math.min(1, 1 / distinctRelatedSources.size + 0.5);

  const capturedAt = Date.parse(item.capturedAt);
  const now = Date.parse(context.now);
  const ageDays =
    Number.isFinite(capturedAt) && Number.isFinite(now)
      ? Math.max(0, now - capturedAt) / 86_400_000
      : 365;
  const recency = Math.exp(-ageDays / 30);

  return scoreEvidenceQuality({
    authority: source === undefined ? 0.4 : baselineSourceAuthority(source.kind),
    directness,
    recency,
    independence,
    corroboration,
    specificity: Math.min(1, specificity),
    contradictionPenalty,
  });
}

function tokenize(value: string): string[] {
  return normalize(value)
    .split(/[^\\p{L}\\p{N}]+/gu)
    .filter((token) => token.length >= 2);
}

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/\\s+/gu, " ");
}

function assertUnitInterval(value: number, field: string): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new RangeError(`${field} must be a finite number between 0 and 1.`);
  }
}
