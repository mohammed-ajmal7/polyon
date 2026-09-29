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

export type CommittedEventListener = (
  event: import("@polyon/contracts").DomainEvent,
) => void | Promise<void>;

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
  private readonly committedEventListeners = new Set<CommittedEventListener>();
  private readonly committedEventListeners = new Set<CommittedEventListener>();

  constructor(readonly rootDir: string) {
    this.database = new FileDomainDatabase(join(rootDir, "domain-state.json"));
    const snapshot = this.database.snapshotWithRevision();
    this.state = snapshot.state;
    this.revision = snapshot.revision;
    this.context = createStateContext(this.state, (nextState) => {
      if (this.transactionActive) {
        throw new DomainTransactionError();
      }

      this.persistAndPublish(nextState);
    });
  }

  get agentRuns() {
    return this.context.agentRuns;
  }

  get jobs() {
    return this.context.jobs;
  }

  get approvals() {
    return this.context.approvals;
  }

  get debates() {
    return this.context.debates;
  }

  get evidence() {
    return this.context.evidence;
  }

  get memory() {
    return this.context.memory;
  }

  get memoryEmbeddings() {
    return this.context.memoryEmbeddings;
  }

  get sources() {
    return this.context.sources;
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

  get a2aPushNotificationConfigs() {
    return this.context.a2aPushNotificationConfigs;
  }

  get events() {
    return this.context.events;
  }

  subscribeCommittedEvents(listener: CommittedEventListener): () => void {
    this.committedEventListeners.add(listener);
    return () => this.committedEventListeners.delete(listener);
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
      const result = work(stagedContext);

      const nextRevision = this.database.replaceIfRevision(stagedState, snapshot.revision);
      const previousEventIds = new Set(this.state.events.map((event) => event.id));
      Object.assign(this.state, stagedState);
      this.revision = nextRevision;
      this.publishCommittedEvents(stagedState.events, previousEventIds);

      return result;
    } finally {
      this.transactionActive = false;
    }
  }

  private persistAndPublish(nextState: ReturnType<FileDomainDatabase["snapshot"]>): void {
    const previousEventIds = new Set(this.state.events.map((event) => event.id));
    const nextRevision = this.database.replaceIfRevision(nextState, this.revision);
    Object.assign(this.state, nextState);
    this.revision = nextRevision;
    this.publishCommittedEvents(nextState.events, previousEventIds);
  }

  private publishCommittedEvents(
    events: readonly import("@polyon/contracts").DomainEvent[],
    previousEventIds: ReadonlySet<string>,
  ): void {
    for (const event of events) {
      if (previousEventIds.has(event.id)) continue;
      for (const listener of this.committedEventListeners) {
        void listener(event);
      }
    }
  }
}
