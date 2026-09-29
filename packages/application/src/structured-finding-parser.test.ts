import { describe, expect, it } from "vitest";

import { parseStructuredFinding } from "./structured-finding-parser";

describe("parseStructuredFinding", () => {
  it("parses a valid structured finding envelope", () => {
    const finding = parseStructuredFinding({
      id: "finding-1",
      agentId: "researcher",
      content: [
        "Analysis:",
        JSON.stringify({
          claim: "Revenue increased after the launch.",
          confidence: 0.81,
          assumptions: ["Reported revenue is comparable."],
          counterarguments: ["Seasonality may explain part of the increase."],
          disposition: "SUPPORTED",
          evidenceIds: ["evidence-1"],
        }),
      ].join("\n"),
      evidence: [
        {
          id: "evidence-1",
          sourceId: "source-1",
          kind: "WEB",
          claim: "Revenue increased after the launch.",
          supportingContent: "Revenue was up 12%.",
          capturedAt: "2026-09-29T00:00:00.000Z",
        },
      ],
      createdAt: "2026-09-29T00:00:00.000Z",
    });

    expect(finding).toEqual(expect.objectContaining({
      claim: "Revenue increased after the launch.",
      confidence: 0.81,
      disposition: "SUPPORTED",
    }));
    expect(finding?.evidence).toEqual([{ evidenceId: "evidence-1", sourceId: "source-1" }]);
  });

  it("returns undefined for malformed or unknown evidence references", () => {
    const result = parseStructuredFinding({
      id: "finding-2",
      agentId: "researcher",
      content: JSON.stringify({
        claim: "claim",
        confidence: 0.7,
        assumptions: [],
        counterarguments: [],
        disposition: "SUPPORTED",
        evidenceIds: ["missing"],
      }),
      evidence: [],
      createdAt: "2026-09-29T00:00:00.000Z",
    });

    expect(result).toBeUndefined();
  });
});