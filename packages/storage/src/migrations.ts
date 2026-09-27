export const CURRENT_DURABLE_DOMAIN_VERSION = 1;

export interface DurableMigration {
  readonly fromVersion: number;
  readonly toVersion: number;
  migrate(
    state: Readonly<Record<string, unknown>>,
  ): Readonly<Record<string, unknown>>;
}

export type DurableMigrationErrorKind =
  | "INVALID_VERSION"
  | "FUTURE_VERSION"
  | "MIGRATION_MISSING"
  | "MIGRATION_AMBIGUOUS"
  | "MIGRATION_INVALID_TARGET";

export class DurableMigrationError extends Error {
  readonly kind: DurableMigrationErrorKind;

  constructor(kind: DurableMigrationErrorKind, message: string) {
    super(message);
    this.name = "DurableMigrationError";
    this.kind = kind;
  }
}

export interface DurableMigrationResult {
  readonly value: Record<string, unknown>;
  readonly migrated: boolean;
  readonly fromVersion: number;
  readonly toVersion: number;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function readVersion(value: unknown): number {
  if (
    value === null ||
    typeof value !== "object" ||
    !("version" in value) ||
    typeof value.version !== "number" ||
    !Number.isInteger(value.version) ||
    value.version < 0
  ) {
    throw new DurableMigrationError(
      "INVALID_VERSION",
      "Durable snapshot must contain a non-negative integer version.",
    );
  }

  return value.version;
}

export function migrateDurableSnapshot(
  value: unknown,
  currentVersion: number,
  migrations: readonly DurableMigration[],
): DurableMigrationResult {
  const fromVersion = readVersion(value);

  if (fromVersion > currentVersion) {
    throw new DurableMigrationError(
      "FUTURE_VERSION",
      `Durable snapshot version ${fromVersion} is newer than the supported version ${currentVersion}.`,
    );
  }

  if (fromVersion === currentVersion) {
    return {
      value: clone(value as Record<string, unknown>),
      migrated: false,
      fromVersion,
      toVersion: currentVersion,
    };
  }

  let current = clone(value as Record<string, unknown>);
  let version = fromVersion;

  while (version < currentVersion) {
    const candidates = migrations.filter(
      (migration) => migration.fromVersion === version,
    );

    if (candidates.length === 0) {
      throw new DurableMigrationError(
        "MIGRATION_MISSING",
        `No durable migration is registered from version ${version}.`,
      );
    }

    if (candidates.length > 1) {
      throw new DurableMigrationError(
        "MIGRATION_AMBIGUOUS",
        `Multiple durable migrations are registered from version ${version}.`,
      );
    }

    const migration = candidates[0]!;

    if (
      migration.toVersion <= migration.fromVersion ||
      migration.toVersion > currentVersion
    ) {
      throw new DurableMigrationError(
        "MIGRATION_INVALID_TARGET",
        `Durable migration ${migration.fromVersion} -> ${migration.toVersion} does not lead toward supported version ${currentVersion}.`,
      );
    }

    current = {
      ...clone(migration.migrate(current)),
      version: migration.toVersion,
    };
    version = migration.toVersion;
  }

  return {
    value: current,
    migrated: true,
    fromVersion,
    toVersion: version,
  };
}

export const durableMigrations: readonly DurableMigration[] = [];
