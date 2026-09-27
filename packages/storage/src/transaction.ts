import type { DomainEvent } from "@polyon/contracts";

import type { DomainStores } from "./domain-stores";
import type { DurableDomainState } from "./file-database";

export interface DomainStoreTransactionContext extends DomainStores {
  readonly events: {
    append(event: DomainEvent): void;
    get(eventId: DomainEvent["id"]): DomainEvent | undefined;
    list(): readonly DomainEvent[];
    listByConversation(conversationId: NonNullable<DomainEvent["conversationId"]>): readonly DomainEvent[];
    listByMission(missionId: NonNullable<DomainEvent["missionId"]>): readonly DomainEvent[];
    listByTask(taskId: NonNullable<DomainEvent["taskId"]>): readonly DomainEvent[];
    listByExecution(executionId: NonNullable<DomainEvent["executionId"]>): readonly DomainEvent[];
  };
}

export interface DomainUnitOfWork {
  transaction<T>(work: (context: DomainStoreTransactionContext) => T): T;
}

export type DurableCollectionKey = keyof Omit<DurableDomainState, "version">;
