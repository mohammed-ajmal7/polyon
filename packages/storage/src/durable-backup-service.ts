import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";

import type { DurableDomainState } from "./file-database";
import { FileDomainDatabase } from "./file-database";

export interface DurableBackupServiceOptions {
  readonly database: FileDomainDatabase;
}

export class DurableBackupService {
  constructor(private readonly database: FileDomainDatabase) {}

  backup(destinationPath: string): void {
    const destination = destinationPath.trim();
    if (destination === "") throw new RangeError("Backup destination must not be empty.");

    const source = this.database.path;
    if (!existsSync(source)) throw new Error("Cannot back up a durable database that does not exist.");

    mkdirSync(dirname(destination), { recursive: true });
    const temp = destination + ".tmp";
    copyFileSync(source, temp);
    renameSync(temp, destination);
  }

  restore(snapshotPath: string): void {
    const source = snapshotPath.trim();
    if (source === "") throw new RangeError("Restore source must not be empty.");
    if (!existsSync(source)) throw new Error("Restore source does not exist.");

    const raw = readFileSync(source, "utf8");
    const parsed = JSON.parse(raw) as DurableDomainState;
    // FileDomainDatabase validates the full schema/version when reopened.
    const destination = this.database.path;
    mkdirSync(dirname(destination), { recursive: true });
    const temp = destination + ".restore.tmp";
    writeFileSync(temp, JSON.stringify(parsed) + "\n", "utf8");
    renameSync(temp, destination);
  }
}
