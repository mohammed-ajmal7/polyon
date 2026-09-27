import type {
  ApprovalRequest,
  Artifact,
  Conversation,
  Execution,
  Message,
  Mission,
  MissionPlanProposal,
  PolicyDecision,
  Task,
} from "@polyon/contracts";

import { InMemoryEntityStore, type EntityStore } from "./entity-store";
import { InMemoryEventStore } from "./event-store";
import type { DomainStoreTransactionContext, DomainUnitOfWork } from "./transaction";

export type ApprovalRequestStore = EntityStore<ApprovalRequest>;
export type ArtifactStore = EntityStore<Artifact>;
export type ConversationStore = EntityStore<Conversation>;
export type ExecutionStore = EntityStore<Execution>;
export type MessageStore = EntityStore<Message>;
export type MissionStore = EntityStore<Mission>;
export type MissionPlanProposalStore = EntityStore<MissionPlanProposal>;
export type PolicyDecisionStore = EntityStore<PolicyDecision>;
export type TaskStore = EntityStore<Task>;

export interface DomainStores {
  readonly approvals: ApprovalRequestStore;
  readonly artifacts: ArtifactStore;
  readonly conversations: ConversationStore;
  readonly executions: ExecutionStore;
  readonly messages: MessageStore;
  readonly missions: MissionStore;
  readonly missionPlanProposals: MissionPlanProposalStore;
  readonly policyDecisions: PolicyDecisionStore;
  readonly tasks: TaskStore;
}

function restoreStore<TEntity extends { readonly id: string }>(
  store: EntityStore<TEntity>,
  snapshot: readonly TEntity[],
): void {
  for (const entity of store.list()) {
    store.delete(entity.id);
  }

  for (const entity of snapshot) {
    store.save(entity);
  }
}

export class InMemoryDomainStores implements DomainStores, DomainUnitOfWork {
  readonly approvals: ApprovalRequestStore = new InMemoryEntityStore<ApprovalRequest>();
  readonly artifacts: ArtifactStore = new InMemoryEntityStore<Artifact>();
  readonly conversations: ConversationStore = new InMemoryEntityStore<Conversation>();
  readonly executions: ExecutionStore = new InMemoryEntityStore<Execution>();
  readonly messages: MessageStore = new InMemoryEntityStore<Message>();
  readonly missions: MissionStore = new InMemoryEntityStore<Mission>();
  readonly missionPlanProposals: MissionPlanProposalStore =
    new InMemoryEntityStore<MissionPlanProposal>();
  readonly policyDecisions: PolicyDecisionStore = new InMemoryEntityStore<PolicyDecision>();
  readonly tasks: TaskStore = new InMemoryEntityStore<Task>();
  readonly events = new InMemoryEventStore();

  transaction<T>(work: (context: DomainStoreTransactionContext) => T): T {
    const snapshots = {
      approvals: this.approvals.list(),
      artifacts: this.artifacts.list(),
      conversations: this.conversations.list(),
      executions: this.executions.list(),
      messages: this.messages.list(),
      missions: this.missions.list(),
      missionPlanProposals: this.missionPlanProposals.list(),
      policyDecisions: this.policyDecisions.list(),
      tasks: this.tasks.list(),
      events: this.events.list(),
    };

    try {
      return work(this);
    } catch (error) {
      restoreStore(this.approvals, snapshots.approvals);
      restoreStore(this.artifacts, snapshots.artifacts);
      restoreStore(this.conversations, snapshots.conversations);
      restoreStore(this.executions, snapshots.executions);
      restoreStore(this.messages, snapshots.messages);
      restoreStore(this.missions, snapshots.missions);
      restoreStore(this.missionPlanProposals, snapshots.missionPlanProposals);
      restoreStore(this.policyDecisions, snapshots.policyDecisions);
      restoreStore(this.tasks, snapshots.tasks);
      this.events.restore(snapshots.events);
      throw error;
    }
  }
}
