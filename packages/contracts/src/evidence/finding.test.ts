import { describe, expect, it } from "vitest";

import type { Finding } from "./finding";

describe("Finding contract", () => {
  it("represents evidence-linked agent findings explicitly", () => {
    const finding: Finding = {
      id: "finding-1",
      agentId: "researcher",
      claim: "The event was publicly announced.",
      evidence: [
        {
          evidenceId: "evidence-1",
          sourceId: "source-1",
          locator: "https://example.com/event",
          relevance: 0.95,
        },
      ],
      confidence: 0.82,
      assumptions: ["The cited announcement is authentic."],
      counterarguments: ["The announcement may have been updated later."],
      disposition: "SUPPORTED",
      createdAt: "2026-09-29T00:00:00.000Z",
    };

    expect(finding.evidence[0]?.evidenceId).toBe("evidence-1");
    expect(finding.confidence).toBe(0.82);
  });
});