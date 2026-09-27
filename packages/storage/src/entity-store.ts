/// <reference path="./node-runtime.d.ts" />

import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";

export interface EntityWithId {
  readonly id: string;
}

export interface EntityStore<TEntity extends EntityWithId> {
  get(id: TEntity["id"]): TEntity | undefined;
  save(entity: TEntity): void;
  delete(id: TEntity["id"]): boolean;
  list(): readonly TEntity[];
}

export class StorageFileFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StorageFileFormatError";
  }
}

interface EntitySnapshot<TEntity extends EntityWithId> {
  readonly version: 1;
  readonly entities: readonly TEntity[];
}

function cloneEntity<TEntity extends EntityWithId>(entity: TEntity): TEntity {
  return structuredClone(entity);
}

function parseSnapshot<TEntity extends EntityWithId>(
  filePath: string,
  content: string,
): readonly TEntity[] {
  let parsed: unknown;

  try {
    parsed = JSON.parse(content);
  } catch (error) {
    throw new StorageFileFormatError(
      `Unable to parse storage file ${filePath}: ${error instanceof Error ? error.message : "invalid JSON"}.`,
    );
  }

  if (
    parsed === null ||
    typeof parsed !== "object" ||
    !("version" in parsed) ||
    parsed.version !== 1 ||
    !("entities" in parsed) ||
    !Array.isArray(parsed.entities)
  ) {
    throw new StorageFileFormatError(
      `Unsupported or invalid entity storage snapshot: ${filePath}.`,
    );
  }

  const ids = new Set<string>();

  for (const entity of parsed.entities) {
    if (
      entity === null ||
      typeof entity !== "object" ||
      !("id" in entity) ||
      typeof entity.id !== "string"
    ) {
      throw new StorageFileFormatError(
        `Invalid entity record in storage snapshot: ${filePath}.`,
      );
    }

    if (ids.has(entity.id)) {
      throw new StorageFileFormatError(
        `Duplicate entity ID in storage snapshot: ${entity.id}.`,
      );
    }

    ids.add(entity.id);
  }

  return parsed.entities as TEntity[];
}

function readSnapshot<TEntity extends EntityWithId>(
  filePath: string,
): Map<TEntity["id"], TEntity> {
  if (!existsSync(filePath)) {
    return new Map();
  }

  return new Map(
    parseSnapshot<TEntity>(filePath, readFileSync(filePath, "utf8")).map((entity) => [
      entity.id,
      cloneEntity(entity),
    ]),
  );
}

function writeSnapshot<TEntity extends EntityWithId>(
  filePath: string,
  entities: Map<TEntity["id"], TEntity>,
): void {
  mkdirSync(dirname(filePath), { recursive: true });

  const snapshot: EntitySnapshot<TEntity> = {
    version: 1,
    entities: [...entities.values()].map(cloneEntity),
  };
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;

  writeFileSync(tempPath, JSON.stringify(snapshot) + "\n", "utf8");

  try {
    const fileDescriptor = openSync(tempPath, "r");
    try {
      fsyncSync(fileDescriptor);
    } finally {
      closeSync(fileDescriptor);
    }

    renameSync(tempPath, filePath);
  } catch (error) {
    try {
      unlinkSync(tempPath);
    } catch {
      // Preserve the original persistence error.
    }
    throw error;
  }
}

export class InMemoryEntityStore<TEntity extends EntityWithId>
  implements EntityStore<TEntity>
{
  private readonly entities = new Map<TEntity["id"], TEntity>();

  get(id: TEntity["id"]): TEntity | undefined {
    const entity = this.entities.get(id);

    return entity === undefined ? undefined : cloneEntity(entity);
  }

  save(entity: TEntity): void {
    this.entities.set(entity.id, cloneEntity(entity));
  }

  delete(id: TEntity["id"]): boolean {
    return this.entities.delete(id);
  }

  list(): readonly TEntity[] {
    return [...this.entities.values()].map(cloneEntity);
  }
}

export class FileEntityStore<TEntity extends EntityWithId>
  implements EntityStore<TEntity>
{
  private readonly entities: Map<TEntity["id"], TEntity>;

  constructor(private readonly filePath: string) {
    this.entities = readSnapshot<TEntity>(filePath);
  }

  get(id: TEntity["id"]): TEntity | undefined {
    const entity = this.entities.get(id);

    return entity === undefined ? undefined : cloneEntity(entity);
  }

  save(entity: TEntity): void {
    this.entities.set(entity.id, cloneEntity(entity));
    writeSnapshot(this.filePath, this.entities);
  }

  delete(id: TEntity["id"]): boolean {
    const deleted = this.entities.delete(id);

    if (deleted) {
      writeSnapshot(this.filePath, this.entities);
    }

    return deleted;
  }

  list(): readonly TEntity[] {
    return [...this.entities.values()].map(cloneEntity);
  }
}
