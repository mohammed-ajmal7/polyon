import type { Source } from "@polyon/contracts";
import { describe, expect, it } from "vitest";

import { assessEvidenceQuality, rankEvidenceQuality } from "./evidence-quality-service";

const now = "2026-09-29T12:00:00.000Z";

const source = {
  id: "source-1",
  kind: "API" as const,
  title: "Authoritative API",
  locator: "https://example.com/api",
  retrievedAt: now,
};

const evidence = {
  id: "evidence-1",
  sourceId: source.id,
  kind: "SUPPORTING" as const,
  claim: "POLYON has durable jobs",
  supportingContent: "The API reports durable jobs.",
  capturedAt: now,
};

describe("evidence quality scoring", () => {
  it("weights authoritative direct evidence highly", () => {
    const assessment = assessEvidenceQuality({
      evidence,
      source,
      now,
    });

    expect(assessment.score).toBeGreaterThanOrEqual(75);
    expect(assessment.band).toBe("HIGH");
    expect(assessment.sourceQuality).toBe(95);
    expect(assessment.directness).toBe(90);
  });

  it("adds corroboration and penalizes contradictions", () => {
    const corroborating = {
      ...evidence,
      id: "evidence-2",
      sourceId: "source-2",
    };
    const contradicting = {
      ...evidence,
      id: "evidence-3",
      sourceId: "source-3",
      kind: "CONTRADICTING" as const,
    };

    const baseline = assessEvidenceQuality({
      evidence,
      source,
      now,
    });
    const assessed = assessEvidenceQuality({
      evidence,
      source,
      now,
      corpus: [evidence, corroborating, contradicting],
    });

    expect(assessed.corroboration).toBe(10);
    expect(assessed.contradictionPenalty).toBe(10);
    expect(assessed.score).toBeLessThanOrEqual(baseline.score);
  });

  it("ranks higher-quality evidence deterministically", () => {
    const lower = {
      ...evidence,
      id: "evidence-low",
      sourceId: "user-source",
    };
    const lowerSource: Source = {
      id: "user-source",
      kind: "USER_PROVIDED",
      title: "User note",
      locator: "memory://note",
      retrievedAt: now,
    };

    const ranked = rankEvidenceQuality(
      [lower, evidence],
      new Map([
        [source.id, source],
        [lowerSource.id, lowerSource],
      ]),
      now,
    );

    expect(ranked.map((item) => item.evidenceId)).toEqual(["evidence-1", "evidence-low"]);
  });
});
