/// <reference path="./node-runtime.d.ts" />

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { FileDomainDatabase } from "./file-database";
import { CURRENT_DURABLE_DOMAIN_VERSION } from "./migrations";

function legacySnapshot(version: number): Record<string, unknown> {
  return {
    version,
    agentRuns: [],
    approvals: [],
    artifacts: [],
    conversations: [],
    executions: [],
    messages: [],
    missions: [],
    missionPlanProposals: [],
    policyDecisions: [],
    tasks: [],
    events: [],
  };
}

describe("FileDomainDatabase migrations", () => {
  it("migrates a legacy snapshot on open and persists the upgraded version", () => {
    const directory = mkdtempSync(join(tmpdir(), "polyon-database-"));
    const filePath = join(directory, "domain-state.json");

    try {
      writeFileSync(filePath, JSON.stringify(legacySnapshot(0)), "utf8");

      const database = new FileDomainDatabase(filePath, [
        {
          fromVersion: 0,
          toVersion: CURRENT_DURABLE_DOMAIN_VERSION,
          migrate(state) {
            return {
              ...state,
              agentRuns: [],
              debates: [],
              evidence: [],
              memory: [],
              memoryEmbeddings: [],
              sources: [],
              jobs: [],
              a2aPushNotificationConfigs: [],
              migrated: true,
            };
          },
        },
      ]);

      expect(database.snapshot()).toMatchObject({
        version: CURRENT_DURABLE_DOMAIN_VERSION,
        migrated: true,
      });

      expect(JSON.parse(readFileSync(filePath, "utf8"))).toMatchObject({
        version: CURRENT_DURABLE_DOMAIN_VERSION,
        migrated: true,
      });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("creates the parent directory before the first durable write", () => {
    const root = mkdtempSync(join(tmpdir(), "polyon-database-"));
    const filePath = join(root, "nested", "domain-state.json");

    try {
      const database = new FileDomainDatabase(filePath);

      expect(existsSync(join(root, "nested"))).toBe(false);

      database.replace(database.snapshot());

      expect(existsSync(filePath)).toBe(true);
      expect(existsSync(`${filePath}.lock`)).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("does not rewrite the legacy snapshot when migration fails", () => {
    const directory = mkdtempSync(join(tmpdir(), "polyon-database-"));
    const filePath = join(directory, "domain-state.json");
    const legacyRaw = JSON.stringify(legacySnapshot(0));

    try {
      writeFileSync(filePath, legacyRaw, "utf8");

      expect(
        () =>
          new FileDomainDatabase(filePath, [
            {
              fromVersion: 0,
              toVersion: CURRENT_DURABLE_DOMAIN_VERSION,
              migrate() {
                throw new Error("migration failed");
              },
            },
          ]),
      ).toThrow("migration failed");

      expect(readFileSync(filePath, "utf8")).toBe(legacyRaw);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
