/// <reference path="./node-runtime.d.ts" />

import { join } from "node:path";

import type { DomainStoreTransactionContext, DomainUnitOfWork } from "./transaction";
import { FileDomainDatabase } from "./file-database";
import { createStateContext } from "./state-store";
import type { DomainStores } from "./domain-stores";
import type { EventStore } from "./event-store";

export interface DurableDomainStores extends DomainStores, DomainUnitOfWork {
  readonly events: EventStore;
  readonly rootDir: string;
}

export class FileDomainStores implements DurableDomainStores {
  private state = this.database.snapshot();

  constructor(readonly rootDir: string) {}

  private readonly database = new FileDomainDatabase(join(this.rootDir, "domain-state.json"));

  private readonly context = createStateContext(
    this.state,
    (state) => {
      this.database.replace(state);
      this.state = this.database.snapshot();
    },
  );

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
    const stagedState = this.database.snapshot();
    const stagedContext = createStateContext(stagedState);

    const result = work(stagedContext);

    this.database.replace(stagedState);
    this.state = this.database.snapshot();

    return result;
  }
}
