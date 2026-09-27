import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, it } from "vitest";

import { ScopedArtifactWriteToolAdapter } from "./scoped-artifact-write-tool-adapter";

function cleanup(root: string): void {
  rmSync(root, { recursive: true, force: true });
}

describe("ScopedArtifactWriteToolAdapter", () => {
  it("atomically creates a text artifact inside the configured root", async () => {
    const root = mkdtempSync(join(tmpdir(), "polyon-artifact-"));

    try {
      const adapter = new ScopedArtifactWriteToolAdapter({
        toolId: "artifact.write.scoped",
        rootDir: root,
      });

      const result = await adapter.invoke({
        input: {
          name: "report.txt",
          content: "POLYON",
          kind: "REPORT",
          mimeType: "text/plain",
        },
      });

      expect(result.output.created).toBe(true);
      expect(result.output.status).toBe("AVAILABLE");
      expect(readFileSync(join(root, "report.txt"), "utf8")).toBe("POLYON");
      expect(result.output.sizeBytes).toBe(6);
      expect(result.output.sha256).toHaveLength(64);
    } finally {
      cleanup(root);
    }
  });

  it("replays identical writes idempotently", async () => {
    const root = mkdtempSync(join(tmpdir(), "polyon-artifact-"));

    try {
      const adapter = new ScopedArtifactWriteToolAdapter({
        toolId: "artifact.write.scoped",
        rootDir: root,
      });

      const first = await adapter.invoke({
        input: {
          name: "same.txt",
          content: "same",
        },
      });
      const second = await adapter.invoke({
        input: {
          name: "same.txt",
          content: "same",
        },
      });

      expect(first.output.artifactId).toBe(second.output.artifactId);
      expect(first.output.created).toBe(true);
      expect(second.output.created).toBe(false);
      expect(
        existsSync(join(root, "same.txt." + first.output.sha256.slice(0, 16) + ".tmp")),
      ).toBe(false);
    } finally {
      cleanup(root);
    }
  });

  it("fails closed when an existing target contains different content", async () => {
    const root = mkdtempSync(join(tmpdir(), "polyon-artifact-"));
    const target = join(root, "conflict.txt");

    try {
      writeFileSync(target, "old");

      const adapter = new ScopedArtifactWriteToolAdapter({
        toolId: "artifact.write.scoped",
        rootDir: root,
      });

      await expect(
        adapter.invoke({
          input: {
            name: "conflict.txt",
            content: "new",
          },
        }),
      ).rejects.toMatchObject({
        kind: "PATH_CONFLICT",
      });
    } finally {
      cleanup(root);
    }
  });

  it("rejects absolute and traversal paths", async () => {
    const root = mkdtempSync(join(tmpdir(), "polyon-artifact-"));
    const outside = mkdtempSync(join(tmpdir(), "polyon-artifact-outside-"));

    try {
      const adapter = new ScopedArtifactWriteToolAdapter({
        toolId: "artifact.write.scoped",
        rootDir: root,
      });

      await expect(
        adapter.invoke({
          input: {
            name: "../outside.txt",
            content: "blocked",
          },
        }),
      ).rejects.toMatchObject({
        kind: "OUTSIDE_ROOT",
      });

      await expect(
        adapter.invoke({
          input: {
            name: outside,
            content: "blocked",
          },
        }),
      ).rejects.toMatchObject({
        kind: "OUTSIDE_ROOT",
      });
    } finally {
      cleanup(root);
      cleanup(outside);
    }
  });
});
