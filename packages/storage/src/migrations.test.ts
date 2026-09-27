import { describe, expect, it } from "vitest";

import { DurableMigrationError, migrateDurableSnapshot, type DurableMigration } from "./migrations";

describe("migrateDurableSnapshot", () => {
  const migrations: readonly DurableMigration[] = [
    {
      fromVersion: 0,
      toVersion: 1,
      migrate(state) {
        return {
          ...state,
          missions: [],
        };
      },
    },
    {
      fromVersion: 1,
      toVersion: 2,
      migrate(state) {
        return {
          ...state,
          migrationMarker: "v2",
        };
      },
    },
    {
      fromVersion: 2,
      toVersion: 3,
      migrate(state) {
        return {
          ...state,
          memoryEmbeddings: [],
        };
      },
    },
  ];

  it("applies migrations sequentially to the requested version", () => {
    const legacy = {
      version: 0,
      events: [],
    };

    expect(migrateDurableSnapshot(legacy, 3, migrations)).toEqual({
      value: {
        version: 3,
        events: [],
        missions: [],
        migrationMarker: "v2",
        memoryEmbeddings: [],
      },
      migrated: true,
      fromVersion: 0,
      toVersion: 3,
    });

    expect(legacy).toEqual({
      version: 0,
      events: [],
    });
  });

  it("returns the current snapshot without applying migrations", () => {
    const current = {
      version: 2,
      events: [],
    };

    expect(migrateDurableSnapshot({ version: 3, events: [], memoryEmbeddings: [] }, 3, migrations)).toEqual({
      value: { version: 3, events: [], memoryEmbeddings: [] },
      migrated: false,
      fromVersion: 3,
      toVersion: 3,
    });
  });

  it("rejects snapshots newer than the supported version", () => {
    expect(() => migrateDurableSnapshot({ version: 4 }, 3, migrations)).toThrowError(
      new DurableMigrationError(
        "FUTURE_VERSION",
        "Durable snapshot version 4 is newer than the supported version 3.",
      ),
    );
  });

  it("rejects a missing migration step", () => {
    expect(() =>
      migrateDurableSnapshot(
        {
          version: 0,
        },
        3,
        [
          {
            fromVersion: 1,
            toVersion: 2,
            migrate(state) {
              return state;
            },
          },
        ],
      ),
    ).toThrowError(
      new DurableMigrationError(
        "MIGRATION_MISSING",
        "No durable migration is registered from version 0.",
      ),
    );
  });

  it("rejects ambiguous migration steps", () => {
    expect(() =>
      migrateDurableSnapshot(
        {
          version: 0,
        },
        1,
        [
          {
            fromVersion: 0,
            toVersion: 1,
            migrate(state) {
              return state;
            },
          },
          {
            fromVersion: 0,
            toVersion: 1,
            migrate(state) {
              return state;
            },
          },
        ],
      ),
    ).toThrowError(
      new DurableMigrationError(
        "MIGRATION_AMBIGUOUS",
        "Multiple durable migrations are registered from version 0.",
      ),
    );
  });

  it("rejects migrations that do not move toward the supported version", () => {
    expect(() =>
      migrateDurableSnapshot(
        {
          version: 0,
        },
        1,
        [
          {
            fromVersion: 0,
            toVersion: 0,
            migrate(state) {
              return state;
            },
          },
        ],
      ),
    ).toThrowError(
      new DurableMigrationError(
        "MIGRATION_INVALID_TARGET",
        "Durable migration 0 -> 0 does not lead toward supported version 1.",
      ),
    );
  });
});
