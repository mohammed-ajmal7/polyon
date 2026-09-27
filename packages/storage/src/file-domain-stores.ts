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
  private readonly context: DomainStoreTransactionContext;

  constructor(readonly rootDir: string) {
    this.database = new FileDomainDatabase(join(rootDir, "domain-state.json"));
    this.state = this.database.snapshot();
    this.context = createStateContext(this.state, (nextState) => {
      this.database.replace(nextState);
      Object.assign(this.state, nextState);
    });
  }

  get approvals() {
    return this.context.approvals;
  }

  get artifacts() {
    return this.context.artifacts;
  }

  get conversations() {
    return this.context.conversations;
  }

  get executions() {
    return this.context.executions;
  }

  get messages() {
    return this.context.messages;
  }

  get missions() {
    return this.context.missions;
  }

  get missionPlanProposals() {
    return this.context.missionPlanProposals;
  }

  get policyDecisions() {
    return this.context.policyDecisions;
  }

  get tasks() {
    return this.context.tasks;
  }

  get events() {
    return this.context.events;
  }

  transaction<T>(work: (context: DomainStoreTransactionContext) => T): T {
    if (this.transactionActive) {
      throw new DomainTransactionError();
    }

    this.transactionActive = true;

    try {
      const stagedState = this.database.snapshot();
      const stagedContext = createStateContext(stagedState);
      const result = work(stagedContext);

      this.database.replace(stagedState);
      Object.assign(this.state, stagedState);

      return result;
    } finally {
      this.transactionActive = false;
    }
  }
}
