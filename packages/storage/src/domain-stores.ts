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

export class InMemoryDomainStores implements DomainStores {
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
}
