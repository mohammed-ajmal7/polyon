import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, it } from "vitest";

import { DurableBackupService } from "./durable-backup-service";
import { FileDomainDatabase } from "./file-database";

describe("DurableBackupService", () => {
  it("backs up and restores the durable database atomically", () => {
    const root = mkdtempSync(join(tmpdir(), "polyon-backup-"));
    try {
      const dbPath = join(root, "state.json");
      const backupPath = join(root, "backup", "state.json");
      const db = new FileDomainDatabase(dbPath);
      const service = new DurableBackupService(db);
      db.replace(db.snapshot());

      service.backup(backupPath);
      expect(readFileSync(backupPath, "utf8")).toContain('"version":2');

      const reopened = new FileDomainDatabase(dbPath);
      service.restore(backupPath);
      expect(reopened.snapshot().version).toBe(2);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
