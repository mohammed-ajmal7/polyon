import type { DomainEvent } from "@polyon/contracts";

import type { DomainStores } from "./domain-stores";
import type { DurableDomainState } from "./file-database";
import type { EventStore } from "./event-store";

export interface DomainStoreTransactionContext extends DomainStores {
  readonly events: EventStore;
}

export interface DomainUnitOfWork {
  transaction<T>(work: (context: DomainStoreTransactionContext) => T): T;
}

export class DomainTransactionError extends Error {
  readonly code = "TRANSACTION_IN_PROGRESS";

  constructor() {
    super("A storage transaction is already in progress.");
    this.name = "DomainTransactionError";
  }
}

export type DurableCollectionKey = keyof Omit<DurableDomainState, "version">;

export type DurableCollection<TEntity extends { readonly id: string }> = readonly TEntity[];
