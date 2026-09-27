import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import type { Artifact } from "@polyon/contracts";
import { InMemoryDomainStores } from "@polyon/storage";
import { describe, expect, it } from "vitest";

import {
  LocalArtifactContentService,
  LocalArtifactContentServiceError,
} from "./local-artifact-content-service";

function createArtifact(location: string, overrides: Partial<Artifact> = {}): Artifact {
  return {
    id: overrides.id ?? "artifact-1",
    kind: overrides.kind ?? "REPORT",
    name: overrides.name ?? "report.txt",
    location,
    status: overrides.status ?? "AVAILABLE",
    createdAt: overrides.createdAt ?? "2026-09-27T01:00:00.000Z",
    updatedAt: overrides.updatedAt ?? "2026-09-27T01:00:00.000Z",
    ...(overrides.mimeType === undefined ? {} : { mimeType: overrides.mimeType }),
    ...(overrides.missionId === undefined ? {} : { missionId: overrides.missionId }),
    ...(overrides.taskId === undefined ? {} : { taskId: overrides.taskId }),
    ...(overrides.executionId === undefined
      ? {}
      : { executionId: overrides.executionId }),
  };
}

describe("LocalArtifactContentService", () => {
  it("reads an available artifact and returns its digest", () => {
    const root = mkdtempSync(join(tmpdir(), "polyon-artifact-read-"));

    try {
      const file = join(root, "report.txt");
      writeFileSync(file, "POLYON");

      const stores = new InMemoryDomainStores();
      stores.artifacts.save(createArtifact(file));

      const service = new LocalArtifactContentService({
        artifacts: stores.artifacts,
        options: { rootDir: root },
      });

      const result = service.read("artifact-1");

      expect(result.content).toBe("POLYON");
      expect(result.sizeBytes).toBe(6);
      expect(result.sha256).toHaveLength(64);
      expect(result.artifact.id).toBe("artifact-1");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects artifacts whose file resolves outside the configured root", () => {
    const root = mkdtempSync(join(tmpdir(), "polyon-artifact-root-"));
    const outside = mkdtempSync(join(tmpdir(), "polyon-artifact-outside-"));

    try {
      const secret = join(outside, "secret.txt");
      writeFileSync(secret, "secret");

      const stores = new InMemoryDomainStores();
      stores.artifacts.save(
        createArtifact(join(root, "..", "polyon-artifact-outside-" + outside.split("polyon-artifact-outside-")[1], "secret.txt")),
      );

      const service = new LocalArtifactContentService({
        artifacts: stores.artifacts,
        options: { rootDir: root },
      });

      expect(() => service.read("artifact-1")).toThrow(
        LocalArtifactContentServiceError,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it("rejects missing files and oversized artifacts", () => {
    const root = mkdtempSync(join(tmpdir(), "polyon-artifact-read-"));

    try {
      const stores = new InMemoryDomainStores();
      stores.artifacts.save(createArtifact(join(root, "missing.txt")));

      const service = new LocalArtifactContentService({
        artifacts: stores.artifacts,
        options: { rootDir: root, maxBytes: 5 },
      });

      expect(() => service.read("artifact-1")).toThrowError(
        /Artifact file does not exist/,
      );

      const file = join(root, "large.txt");
      writeFileSync(file, "123456");
      stores.artifacts.save(
        createArtifact(file, { id: "artifact-2", name: "large.txt" }),
      );

      expect(() => service.read("artifact-2")).toMatchObject({
        kind: "FILE_TOO_LARGE",
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
