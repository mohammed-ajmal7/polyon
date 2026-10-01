import { describe, expect, it } from "vitest";

import { createFinding } from "./finding";

describe("createFinding", () => {
  it("normalizes bounded finding fields without changing confidence semantics", () => {
    const finding = createFinding({
      id: " finding-1 ",
      agentId: " researcher ",
      claim: " The stock fell after the announcement. ",
      evidence: [{ evidenceId: "evidence-1", sourceId: "source-1", relevance: 0.8 }],
      confidence: 0.74,
      assumptions: [" valid assumption ", "  "],
      counterarguments: [" alternative explanation "],
      disposition: "SUPPORTED",
      createdAt: "2026-09-29T00:00:00.000Z",
    });

    expect(finding.id).toBe("finding-1");
    expect(finding.agentId).toBe("researcher");
    expect(finding.claim).toBe("The stock fell after the announcement.");
    expect(finding.assumptions).toEqual(["valid assumption"]);
    expect(finding.confidence).toBe(0.74);
  });

  it("rejects confidence outside the inclusive 0..1 range", () => {
    expect(() =>
      createFinding({
        id: "finding-2",
        agentId: "analyst",
        claim: "claim",
        confidence: 1.1,
        disposition: "INFERRED",
        createdAt: "2026-09-29T00:00:00.000Z",
      }),
    ).toThrow("between 0 and 1");
  });
});
