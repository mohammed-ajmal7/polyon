import type { Evidence, Source } from "@polyon/contracts";

export type EvidenceQualityBand = "HIGH" | "MEDIUM" | "LOW";

export interface EvidenceQualityAssessment {
  readonly evidenceId: string;
  readonly sourceId: string;
  readonly sourceQuality: number;
  readonly directness: number;
  readonly recency: number;
  readonly corroboration: number;
  readonly contradictionPenalty: number;
  readonly score: number;
  readonly band: EvidenceQualityBand;
}

export interface AssessEvidenceInput {
  readonly evidence: Evidence;
  readonly source?: Source;
  readonly now: string;
  readonly corpus?: readonly Evidence[];
}

const MAX_SCORE = 100;

export function assessEvidenceQuality(input: AssessEvidenceInput): EvidenceQualityAssessment {
  validateTimestamp(input.now, "now");

  const sourceQuality = sourceQualityScore(input.source?.kind);
  const directness = directnessScore(input.evidence.kind);
  const recency = recencyScore(input.evidence.capturedAt, input.now);
  const corpus = input.corpus ?? [];
  const normalizedClaim = normalizeClaim(input.evidence.claim);

  const corroborationSources = new Set(
    corpus
      .filter((candidate) => candidate.id !== input.evidence.id)
      .filter((candidate) => normalizeClaim(candidate.claim) === normalizedClaim)
      .filter((candidate) => candidate.kind === input.evidence.kind)
      .map((candidate) => candidate.sourceId),
  );
  const corroboration = Math.min(20, corroborationSources.size * 10);

  const contradictionCount = corpus
    .filter((candidate) => candidate.id !== input.evidence.id)
    .filter((candidate) => normalizeClaim(candidate.claim) === normalizedClaim)
    .filter((candidate) => candidate.kind !== input.evidence.kind)
    .length;
  const contradictionPenalty = Math.min(20, contradictionCount * 10);

  const score = clamp(
    Math.round(
      sourceQuality * 0.4 +
        directness * 0.2 +
        recency * 0.2 +
        corroboration -
        contradictionPenalty,
    ),
  );

  return {
    evidenceId: input.evidence.id,
    sourceId: input.evidence.sourceId,
    sourceQuality,
    directness,
    recency,
    corroboration,
    contradictionPenalty,
    score,
    band: score >= 75 ? "HIGH" : score >= 50 ? "MEDIUM" : "LOW",
  };
}

export function rankEvidenceQuality(
  evidence: readonly Evidence[],
  sources: ReadonlyMap<string, Source>,
  now: string,
): readonly EvidenceQualityAssessment[] {
  const ranked = evidence.map((item) =>
    assessEvidenceQuality({
      evidence: item,
      source: sources.get(item.sourceId),
      now,
      corpus: evidence,
    }),
  );

  return ranked.sort(
    (left, right) =>
      right.score - left.score ||
      right.evidenceId.localeCompare(left.evidenceId),
  );
}

function sourceQualityScore(kind: Source["kind"] | undefined): number {
  switch (kind) {
    case "API":
    case "DATABASE":
      return 95;
    case "DOCUMENT":
      return 90;
    case "WEB":
      return 75;
    case "FILE":
    case "MESSAGE":
      return 65;
    case "USER_PROVIDED":
      return 55;
    case "AGENT_GENERATED":
      return 20;
    case "OTHER":
    case undefined:
      return 40;
  }
}

function directnessScore(kind: Evidence["kind"]): number {
  switch (kind) {
    case "SUPPORTING":
    case "CONTRADICTING":
      return 90;
    case "OBSERVATIONAL":
      return 80;
    case "CONTEXTUAL":
      return 60;
    case "OTHER":
      return 50;
  }
}

function recencyScore(capturedAt: string, now: string): number {
  validateTimestamp(capturedAt, "capturedAt");

  const ageMilliseconds = Math.max(0, Date.parse(now) - Date.parse(capturedAt));
  const ageDays = ageMilliseconds / 86_400_000;
  const halfLifeDays = 30;
  return Math.round(100 * 2 ** (-ageDays / halfLifeDays));
}

function normalizeClaim(claim: string): string {
  return claim.trim().toLowerCase().replace(/\s+/gu, " ");
}

function validateTimestamp(value: string, field: string): void {
  if (!Number.isFinite(Date.parse(value))) {
    throw new RangeError(`${field} must be a valid timestamp.`);
  }
}

function clamp(value: number): number {
  return Math.max(0, Math.min(MAX_SCORE, value));
}
