import type {
  ApprovalRequest,
  Artifact,
  Conversation,
  DomainEvent,
  Execution,
  Message,
  Mission,
  MissionPlanProposal,
  PolicyDecision,
  Task,
} from "@polyon/contracts";

import { type EntityStore } from "./entity-store";
import type { DurableCollectionKey, DomainStoreTransactionContext } from "./transaction";
import type { DurableDomainState } from "./file-database";
import { EventStore } from "./event-store";

export type StateGetter = () => DurableDomainState;
export type StatePersister = (state: DurableDomainState) => void;

export class StateEntityStore<TEntity extends { readonly id: string }>
  implements EntityStore<TEntity>
{
  constructor(
    private readonly getState: StateGetter,
    private readonly persist: StatePersister,
    private readonly collection: DurableCollectionKey,
  ) {}

  get(id: string): TEntity | undefined {
    const entity = this.collectionItems().find((candidate) => candidate.id === id);
    return entity === undefined ? undefined : structuredClone(entity) as TEntity;
  }

  save(entity: TEntity): void {
    const items = this.collectionItems();
    const index = items.findIndex((candidate) => candidate.id === entity.id);

    if (index === -1) {
      items.push(structuredClone(entity) as never);
    } else {
      items[index] = structuredClone(entity) as never;
    }

    this.persist(this.getState());
  }

  delete(id: string): boolean {
    const items = this.collectionItems();
    const index = items.findIndex((candidate) => candidate.id === id);

    if (index === -1) {
      return false;
    }

    items.splice(index, 1);
    this.persist(this.getState());
    return true;
  }

  list(): readonly TEntity[] {
    return itemsClone(this.collectionItems());
  }

  private collectionItems(): { id: string }[] {
    return this.getState()[this.collection] as { id: string }[];
  }
}

function itemsClone<TEntity extends { readonly id: string }>(
  items: readonly TEntity[],
): readonly TEntity[] {
  return items.map((item) => structuredClone(item));
}

class StateEventStore implements EventStore {
  constructor(
    private readonly getState: StateGetter,
    private readonly persist: StatePersister,
  ) {}

  append(event: DomainEvent): void {
    const events = this.getState().events;

    if (events.some((candidate) => candidate.id === event.id)) {
      throw new Error(`Event already exists: ${event.id}.`);
    }

    events.push(structuredClone(event));
    this.persist(this.getState());
  }

  get(eventId: DomainEvent["id"]): DomainEvent | undefined {
    const event = this.getState().events.find((candidate) => candidate.id === eventId);
    return event === undefined ? undefined : structuredClone(event);
  }

  list(): readonly DomainEvent[] {
    return itemsClone(this.getState().events);
  }

  listByConversation(conversationId: NonNullable<DomainEvent["conversationId"]>): readonly DomainEvent[] {
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

export function createStateTransactionContext(
  state: DurableDomainState,
): DomainStoreTransactionContext {
  const persist = () => undefined;
  const getState = () => state;

  return {
    approvals: new StateEntityStore<ApprovalRequest>(getState, persist, "approvals"),
    artifacts: new StateEntityStore<Artifact>(getState, persist, "artifacts"),
    conversations: new StateEntityStore<Conversation>(
      getState,
      persist,
      "conversations",
    ),
    executions: new StateEntityStore<Execution>(getState, persist, "executions"),
    messages: new StateEntityStore<Message>(getState, persist, "messages"),
    missions: new StateEntityStore<Mission>(getState, persist, "missions"),
    missionPlanProposals: new StateEntityStore<MissionPlanProposal>(
      getState,
      persist,
      "missionPlanProposals",
    ),
    policyDecisions: new StateEntityStore<PolicyDecision>(
      getState,
      persist,
      "policyDecisions",
    ),
    tasks: new StateEntityStore<Task>(getState, persist, "tasks"),
    events: new StateEventStore(getState, persist),
  };
}
