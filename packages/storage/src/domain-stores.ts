import type {
  ApprovalRequest,
  Artifact,
  Execution,
  Mission,
  PolicyDecision,
  Task,
} from "@polyon/contracts";

import {
  InMemoryEntityStore,
  type EntityStore,
} from "./entity-store";

export type ApprovalRequestStore = EntityStore<ApprovalRequest>;
export type ArtifactStore = EntityStore<Artifact>;
export type ExecutionStore = EntityStore<Execution>;
export type MissionStore = EntityStore<Mission>;
export type PolicyDecisionStore = EntityStore<PolicyDecision>;
export type TaskStore = EntityStore<Task>;

export interface DomainStores {
  readonly approvals: ApprovalRequestStore;
  readonly artifacts: ArtifactStore;
  readonly executions: ExecutionStore;
  readonly missions: MissionStore;
  readonly policyDecisions: PolicyDecisionStore;
  readonly tasks: TaskStore;
}

export class InMemoryDomainStores implements DomainStores {
  readonly approvals: ApprovalRequestStore = new InMemoryEntityStore<ApprovalRequest>();
  readonly artifacts: ArtifactStore = new InMemoryEntityStore<Artifact>();
  readonly executions: ExecutionStore = new InMemoryEntityStore<Execution>();
  readonly missions: MissionStore = new InMemoryEntityStore<Mission>();
  readonly policyDecisions: PolicyDecisionStore = new InMemoryEntityStore<PolicyDecision>();
  readonly tasks: TaskStore = new InMemoryEntityStore<Task>();
}
