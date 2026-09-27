/// <reference path="./node-runtime.d.ts" />

import { join } from "node:path";

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

import { FileEntityStore, type EntityStore } from "./entity-store";
import type {
  ApprovalRequestStore,
  ArtifactStore,
  ConversationStore,
  DomainStores,
  ExecutionStore,
  MessageStore,
  MissionPlanProposalStore,
  MissionStore,
  PolicyDecisionStore,
  TaskStore,
} from "./domain-stores";
import { FileEventStore, type EventStore } from "./event-store";

export interface DurableDomainStores extends DomainStores {
  readonly events: EventStore;
  readonly rootDir: string;
}

export class FileDomainStores implements DurableDomainStores {
  readonly approvals: ApprovalRequestStore;
  readonly artifacts: ArtifactStore;
  readonly conversations: ConversationStore;
  readonly executions: ExecutionStore;
  readonly messages: MessageStore;
  readonly missions: MissionStore;
  readonly missionPlanProposals: MissionPlanProposalStore;
  readonly policyDecisions: PolicyDecisionStore;
  readonly tasks: TaskStore;
  readonly events: EventStore;

  constructor(readonly rootDir: string) {
    this.approvals = new FileEntityStore<ApprovalRequest>(join(rootDir, "approvals.json"));
    this.artifacts = new FileEntityStore<Artifact>(join(rootDir, "artifacts.json"));
    this.conversations = new FileEntityStore<Conversation>(
      join(rootDir, "conversations.json"),
    );
    this.executions = new FileEntityStore<Execution>(join(rootDir, "executions.json"));
    this.messages = new FileEntityStore<Message>(join(rootDir, "messages.json"));
    this.missions = new FileEntityStore<Mission>(join(rootDir, "missions.json"));
    this.missionPlanProposals = new FileEntityStore<MissionPlanProposal>(
      join(rootDir, "mission-plan-proposals.json"),
    );
    this.policyDecisions = new FileEntityStore<PolicyDecision>(
      join(rootDir, "policy-decisions.json"),
    );
    this.tasks = new FileEntityStore<Task>(join(rootDir, "tasks.json"));
    this.events = new FileEventStore(join(rootDir, "events.json"));
  }
}
