/// <reference path="./node-runtime.d.ts" />

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";

import { FileEntityStore, StorageFileFormatError } from "./entity-store";

type TestEntity = {
  readonly id: string;
  readonly nested: {
    readonly values: string[];
  };
};

function withTempDir(): string {
  return mkdtempSync(join(tmpdir(), "polyon-storage-"));
}

describe("FileEntityStore", () => {
  it("persists entities across store instances", () => {
    const directory = withTempDir();
    const path = join(directory, "entities.json");

    try {
      const first = new FileEntityStore<TestEntity>(path);
      first.save({
        id: "entity-1",
        nested: { values: ["one"] },
      });

      const second = new FileEntityStore<TestEntity>(path);

      expect(second.get("entity-1")).toEqual({
        id: "entity-1",
        nested: { values: ["one"] },
      });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("creates its parent directory on first write", () => {
    const directory = withTempDir();
    const path = join(directory, "nested", "entities.json");

    try {
      const store = new FileEntityStore<TestEntity>(path);

      expect(existsSync(join(directory, "nested"))).toBe(false);

      store.save({
        id: "entity-1",
        nested: { values: ["one"] },
      });

      expect(existsSync(path)).toBe(true);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("updates and deletes durable entities", () => {
    const directory = withTempDir();
    const path = join(directory, "entities.json");

    try {
      const first = new FileEntityStore<TestEntity>(path);
      first.save({ id: "entity-1", nested: { values: ["one"] } });
      first.save({ id: "entity-1", nested: { values: ["two"] } });
      first.save({ id: "entity-2", nested: { values: ["three"] } });

      expect(first.list().map((entity) => entity.id)).toEqual([
        "entity-1",
        "entity-2",
      ]);
      expect(first.get("entity-1")?.nested.values).toEqual(["two"]);
      expect(first.delete("entity-2")).toBe(true);
      expect(first.delete("entity-2")).toBe(false);

      const second = new FileEntityStore<TestEntity>(path);
      expect(second.get("entity-1")?.nested.values).toEqual(["two"]);
      expect(second.get("entity-2")).toBeUndefined();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("does not expose mutable durable state", () => {
    const directory = withTempDir();
    const path = join(directory, "entities.json");

    try {
      const store = new FileEntityStore<TestEntity>(path);
      store.save({ id: "entity-1", nested: { values: ["one"] } });

      const entity = store.get("entity-1")!;
      entity.nested.values.push("two");

      expect(store.get("entity-1")?.nested.values).toEqual(["one"]);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("writes a versioned snapshot that can be inspected independently", () => {
    const directory = withTempDir();
    const path = join(directory, "entities.json");

    try {
      const store = new FileEntityStore<TestEntity>(path);
      store.save({ id: "entity-1", nested: { values: ["one"] } });

      expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({
        version: 1,
        entities: [
          {
            id: "entity-1",
            nested: { values: ["one"] },
          },
        ],
      });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("fails closed on an invalid snapshot instead of treating it as empty", () => {
    const directory = withTempDir();
    const path = join(directory, "entities.json");

    try {
      mkdirSync(directory, { recursive: true });
      writeFileSync(path, "{invalid", "utf8");

      expect(() => new FileEntityStore<TestEntity>(path)).toThrowError(
        StorageFileFormatError,
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("fails closed on an unsupported snapshot version", () => {
    const directory = withTempDir();
    const path = join(directory, "entities.json");

    try {
      writeFileSync(
        path,
        JSON.stringify({
          version: 2,
          entities: [],
        }),
        "utf8",
      );

      expect(() => new FileEntityStore<TestEntity>(path)).toThrowError(
        StorageFileFormatError,
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
