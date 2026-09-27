import type { Artifact } from "@polyon/contracts";
import { describe, expect, it } from "vitest";

import { ScopedArtifactListToolAdapter } from "./scoped-artifact-list-tool-adapter";

const artifact: Artifact = {
  id: "artifact-1",
  kind: "REPORT",
  name: "report.txt",
  location: "/artifacts/report.txt",
  status: "AVAILABLE",
  createdAt: "2026-09-27T01:00:00.000Z",
  updatedAt: "2026-09-27T01:00:00.000Z",
};

describe("ScopedArtifactListToolAdapter", () => {
  it("returns the durable artifact catalog result", async () => {
    const seen: unknown[] = [];
    const adapter = new ScopedArtifactListToolAdapter({
      toolId: "artifact.list.scoped",
      list: (filter) => {
        seen.push(filter);
        return [artifact];
      },
    });

    const result = await adapter.invoke({
      input: {
        missionId: "mission-1",
        kind: "REPORT",
      },
    });

    expect(seen).toEqual([
      {
        missionId: "mission-1",
        kind: "REPORT",
      },
    ]);
    expect(result.output.artifacts).toEqual([artifact]);
  });
});
