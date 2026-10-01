import type {
  AgentRun,
  Job,
  ApprovalRequest,
  Artifact,
  Debate,
  Evidence,
  MemoryEmbedding,
  MemoryEntry,
  Source,
  Conversation,
  DomainEvent,
  Execution,
  Message,
  Mission,
  MissionPlanProposal,
  PolicyDecision,
  Task,
  A2APushNotificationConfig,
} from "@polyon/contracts";

import type { EntityStore } from "./entity-store";
import type { EventStore } from "./event-store";
import type { DomainStoreTransactionContext, DurableCollectionKey } from "./transaction";
import type { DurableDomainState } from "./file-database";

export type StateGetter = () => DurableDomainState;
export type StatePersister = (state: DurableDomainState) => void;

function cloneState(state: DurableDomainState): DurableDomainState {
  return structuredClone(state);
}

function publishState(target: DurableDomainState, source: DurableDomainState): void {
  Object.assign(target, source);
}

export class StateEntityStore<
  TEntity extends { readonly id: string },
> implements EntityStore<TEntity> {
  constructor(
    private readonly getState: StateGetter,
    private readonly persist: StatePersister,
    private readonly collection: DurableCollectionKey,
  ) {}

  get(id: string): TEntity | undefined {
    const entity = this.collectionItems(this.getState()).find((candidate) => candidate.id === id);

    return entity === undefined ? undefined : (structuredClone(entity) as TEntity);
  }

  save(entity: TEntity): void {
    const current = this.getState();
    const next = cloneState(current);
    const items = this.collectionItems(next);
    const index = items.findIndex((candidate) => candidate.id === entity.id);

    if (index === -1) {
      items.push(structuredClone(entity) as never);
    } else {
      items[index] = structuredClone(entity) as never;
    }

    this.persist(next);
    publishState(current, next);
  }

  delete(id: string): boolean {
    const current = this.getState();
    const next = cloneState(current);
    const items = this.collectionItems(next);
    const index = items.findIndex((candidate) => candidate.id === id);

    if (index === -1) {
      return false;
    }

    items.splice(index, 1);
    this.persist(next);
    publishState(current, next);
    return true;
  }

  list(): readonly TEntity[] {
    return this.collectionItems(this.getState()).map((item) => structuredClone(item) as TEntity);
  }

  private collectionItems(state: DurableDomainState): { id: string }[] {
    return state[this.collection] as { id: string }[];
  }
}

export class StateEventStore implements EventStore {
  constructor(
    private readonly getState: StateGetter,
    private readonly persist: StatePersister,
  ) {}

  append(event: DomainEvent): void {
    const current = this.getState();

    if (current.events.some((candidate) => candidate.id === event.id)) {
      throw new Error(`Event already exists: ${event.id}.`);
    }

    const next = cloneState(current);
    next.events.push(structuredClone(event));
    this.persist(next);
    publishState(current, next);
  }

  get(eventId: DomainEvent["id"]): DomainEvent | undefined {
    const event = this.getState().events.find((candidate) => candidate.id === eventId);
    return event === undefined ? undefined : structuredClone(event);
  }

  list(): readonly DomainEvent[] {
    return this.getState().events.map((event) => structuredClone(event));
  }

  listByConversation(
    conversationId: NonNullable<DomainEvent["conversationId"]>,
  ): readonly DomainEvent[] {
    return this.list().filter((event) => event.conversationId === conversationId);
  }

  listByMission(missionId: NonNullable<DomainEvent["missionId"]>): readonly DomainEvent[] {
    return this.list().filter((event) => event.missionId === missionId);
  }

  listByTask(taskId: NonNullable<DomainEvent["taskId"]>): readonly DomainEvent[] {
    return this.list().filter((event) => event.taskId === taskId);
  }

  listByExecution(executionId: NonNullable<DomainEvent["executionId"]>): readonly DomainEvent[] {
    return this.list().filter((event) => event.executionId === executionId);
  }
}

export function createStateContext(
  state: DurableDomainState,
  persist: StatePersister = () => undefined,
): DomainStoreTransactionContext {
  const getState = () => state;

  return {
    agentRuns: new StateEntityStore<AgentRun>(getState, persist, "agentRuns"),
    jobs: new StateEntityStore<Job>(getState, persist, "jobs"),
    approvals: new StateEntityStore<ApprovalRequest>(getState, persist, "approvals"),
    debates: new StateEntityStore<Debate>(getState, persist, "debates"),
    evidence: new StateEntityStore<Evidence>(getState, persist, "evidence"),
    memory: new StateEntityStore<MemoryEntry>(getState, persist, "memory"),
    memoryEmbeddings: new StateEntityStore<MemoryEmbedding>(getState, persist, "memoryEmbeddings"),
    sources: new StateEntityStore<Source>(getState, persist, "sources"),
    artifacts: new StateEntityStore<Artifact>(getState, persist, "artifacts"),
    conversations: new StateEntityStore<Conversation>(getState, persist, "conversations"),
    executions: new StateEntityStore<Execution>(getState, persist, "executions"),
    messages: new StateEntityStore<Message>(getState, persist, "messages"),
    missions: new StateEntityStore<Mission>(getState, persist, "missions"),
    missionPlanProposals: new StateEntityStore<MissionPlanProposal>(
      getState,
      persist,
      "missionPlanProposals",
    ),
    policyDecisions: new StateEntityStore<PolicyDecision>(getState, persist, "policyDecisions"),
    tasks: new StateEntityStore<Task>(getState, persist, "tasks"),
    a2aPushNotificationConfigs: new StateEntityStore<A2APushNotificationConfig>(
      getState,
      persist,
      "a2aPushNotificationConfigs",
    ),
    events: new StateEventStore(getState, persist),
  };
}
