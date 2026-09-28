/// <reference path="./node-runtime.d.ts" />

import { join } from "node:path";

import {
  DomainTransactionError,
  type DomainStoreTransactionContext,
  type DomainUnitOfWork,
} from "./transaction";
import { FileDomainDatabase } from "./file-database";
import { createStateContext } from "./state-store";
import type { DomainStores } from "./domain-stores";
import type { EventStore } from "./event-store";

export interface DurableDomainStores extends DomainStores, DomainUnitOfWork {
  readonly events: EventStore;
  readonly rootDir: string;
}

export class FileDomainStores implements DurableDomainStores {
  private transactionActive = false;

  private readonly database: FileDomainDatabase;
  private readonly state: ReturnType<FileDomainDatabase["snapshot"]>;
  private revision: string;
  private readonly context: DomainStoreTransactionContext;
  private activeContext: DomainStoreTransactionContext | undefined;

  constructor(readonly rootDir: string) {
    this.database = new FileDomainDatabase(join(rootDir, "domain-state.json"));
    const snapshot = this.database.snapshotWithRevision();
    this.state = snapshot.state;
    this.revision = snapshot.revision;
    this.context = createStateContext(this.state, (nextState) => {
      const nextRevision = this.database.replaceIfRevision(nextState, this.revision);
      Object.assign(this.state, nextState);
      this.revision = nextRevision;
    });
  }

  get approvals() {
    return (this.activeContext ?? this.context).approvals;
  }

  get debates() {
    return (this.activeContext ?? this.context).debates;
  }

  get evidence() {
    return (this.activeContext ?? this.context).evidence;
  }

  get memory() {
    return (this.activeContext ?? this.context).memory;
  }

  get memoryEmbeddings() {
    return (this.activeContext ?? this.context).memoryEmbeddings;
  }

  get sources() {
    return (this.activeContext ?? this.context).sources;
  }

  get artifacts() {
    return (this.activeContext ?? this.context).artifacts;
  }

  get conversations() {
    return (this.activeContext ?? this.context).conversations;
  }

  get executions() {
    return (this.activeContext ?? this.context).executions;
  }

  get messages() {
    return (this.activeContext ?? this.context).messages;
  }

  get missions() {
    return (this.activeContext ?? this.context).missions;
  }

  get missionPlanProposals() {
    return (this.activeContext ?? this.context).missionPlanProposals;
  }

  get policyDecisions() {
    return (this.activeContext ?? this.context).policyDecisions;
  }

  get tasks() {
    return (this.activeContext ?? this.context).tasks;
  }

  get events() {
    return (this.activeContext ?? this.context).events;
  }

  transaction<T>(work: (context: DomainStoreTransactionContext) => T): T {
    if (this.transactionActive) {
      throw new DomainTransactionError();
    }

    this.transactionActive = true;

    try {
      const snapshot = this.database.snapshotWithRevision();
      const stagedState = snapshot.state;
      const stagedContext = createStateContext(stagedState);
      this.activeContext = stagedContext;
      const result = work(stagedContext);

      const nextRevision = this.database.replaceIfRevision(stagedState, snapshot.revision);
      Object.assign(this.state, stagedState);
      this.revision = nextRevision;

      return result;
    } finally {
      this.activeContext = undefined;
      this.transactionActive = false;
    }
  }
}
