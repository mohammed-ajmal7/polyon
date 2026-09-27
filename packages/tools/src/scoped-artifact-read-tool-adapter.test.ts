import type { Artifact } from "@polyon/contracts";
import { describe, expect, it } from "vitest";

import {
  ArtifactReadToolError,
  ScopedArtifactReadToolAdapter,
} from "./scoped-artifact-read-tool-adapter";

const artifact: Artifact = {
  id: "artifact-1",
  kind: "REPORT",
  name: "report.txt",
  location: "/artifacts/report.txt",
  status: "AVAILABLE",
  createdAt: "2026-09-27T01:00:00.000Z",
  updatedAt: "2026-09-27T01:00:00.000Z",
};

describe("ScopedArtifactReadToolAdapter", () => {
  it("resolves a durable artifact and forwards the byte limit", async () => {
    const calls: Array<{ id: string; maxBytes: number | undefined }> = [];

    const adapter = new ScopedArtifactReadToolAdapter({
      toolId: "artifact.read.scoped",
      read: (id, maxBytes) => {
        calls.push({ id, maxBytes });
        return {
          artifact,
          content: "POLYON",
          sizeBytes: 6,
          sha256: "a".repeat(64),
        };
      },
    });

    const result = await adapter.invoke({
      input: {
        artifactId: "artifact-1",
        maxBytes: 128,
      },
    });

    expect(calls).toEqual([{ id: "artifact-1", maxBytes: 128 }]);
    expect(result.output).toMatchObject({
      artifact: { id: "artifact-1" },
      content: "POLYON",
      sizeBytes: 6,
      sha256: "a".repeat(64),
    });
  });

  it("fails closed on malformed input", async () => {
    const adapter = new ScopedArtifactReadToolAdapter({
      toolId: "artifact.read.scoped",
      read: () => ({
        artifact,
        content: "POLYON",
        sizeBytes: 6,
        sha256: "a".repeat(64),
      }),
    });

    await expect(
      adapter.invoke({
        input: {
          artifactId: "",
        },
      }),
    ).rejects.toMatchObject({
      kind: "INVALID_INPUT",
    });

    await expect(
      adapter.invoke({
        input: {
          artifactId: "artifact-1",
          maxBytes: 0,
        },
      }),
    ).rejects.toBeInstanceOf(ArtifactReadToolError);
  });
});
