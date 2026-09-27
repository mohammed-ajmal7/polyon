export interface EntityWithId {
  readonly id: string;
}

export interface EntityStore<TEntity extends EntityWithId> {
  get(id: TEntity["id"]): TEntity | undefined;
  save(entity: TEntity): void;
  delete(id: TEntity["id"]): boolean;
  list(): readonly TEntity[];
}

function cloneEntity<TEntity extends EntityWithId>(entity: TEntity): TEntity {
  return structuredClone(entity);
}

export class InMemoryEntityStore<TEntity extends EntityWithId> implements EntityStore<TEntity> {
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
