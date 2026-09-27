import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";

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
    writeFileSync(temp, readFileSync(source, "utf8"), "utf8");
    renameSync(temp, destination);
  }

  restore(snapshotPath: string): void {
    const source = snapshotPath.trim();
    if (source === "") throw new RangeError("Restore source must not be empty.");
    if (!existsSync(source)) throw new Error("Restore source does not exist.");

    const validated = new FileDomainDatabase(source).snapshot();
    const destination = this.database.path;
    mkdirSync(dirname(destination), { recursive: true });
    const temp = destination + ".restore.tmp";
    writeFileSync(temp, JSON.stringify(validated) + "\n", "utf8");
    renameSync(temp, destination);
  }
}
