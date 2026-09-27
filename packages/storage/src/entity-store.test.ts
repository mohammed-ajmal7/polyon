import { describe, expect, it } from "vitest";

import { InMemoryEntityStore } from "./entity-store";

type TestEntity = {
  readonly id: string;
  readonly nested: {
    readonly values: string[];
  };
};

describe("InMemoryEntityStore", () => {
  it("saves and retrieves an entity", () => {
    const store = new InMemoryEntityStore<TestEntity>();
    const entity: TestEntity = {
      id: "entity-1",
      nested: { values: ["one"] },
    };

    store.save(entity);

    expect(store.get("entity-1")).toEqual(entity);
  });

  it("returns undefined for an unknown entity", () => {
    const store = new InMemoryEntityStore<TestEntity>();

    expect(store.get("missing")).toBeUndefined();
  });

  it("updates an existing entity by identifier", () => {
    const store = new InMemoryEntityStore<TestEntity>();

    store.save({ id: "entity-1", nested: { values: ["one"] } });
    store.save({ id: "entity-1", nested: { values: ["two"] } });

    expect(store.get("entity-1")?.nested.values).toEqual(["two"]);
  });

  it("deletes an entity and reports whether it existed", () => {
    const store = new InMemoryEntityStore<TestEntity>();

    store.save({ id: "entity-1", nested: { values: ["one"] } });

    expect(store.delete("entity-1")).toBe(true);
    expect(store.delete("entity-1")).toBe(false);
    expect(store.get("entity-1")).toBeUndefined();
  });

  it("lists stored entities in insertion order", () => {
    const store = new InMemoryEntityStore<TestEntity>();

    store.save({ id: "entity-1", nested: { values: ["one"] } });
    store.save({ id: "entity-2", nested: { values: ["two"] } });

    expect(store.list().map((entity) => entity.id)).toEqual(["entity-1", "entity-2"]);
  });

  it("does not expose mutable store state", () => {
    const store = new InMemoryEntityStore<TestEntity>();
    store.save({ id: "entity-1", nested: { values: ["one"] } });

    const retrieved = store.get("entity-1")!;
    retrieved.nested.values.push("two");

    expect(store.get("entity-1")?.nested.values).toEqual(["one"]);
  });

  it("does not retain mutable source state", () => {
    const store = new InMemoryEntityStore<TestEntity>();
    const entity: TestEntity = {
      id: "entity-1",
      nested: { values: ["one"] },
    };

    store.save(entity);
    entity.nested.values.push("two");

    expect(store.get("entity-1")?.nested.values).toEqual(["one"]);
  });
});
