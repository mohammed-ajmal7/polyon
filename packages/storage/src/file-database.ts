/// <reference path="./node-runtime.d.ts" />

import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname } from "node:path";

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

export interface DurableDomainState {
  readonly version: 1;
  approvals: ApprovalRequest[];
  artifacts: Artifact[];
  conversations: Conversation[];
  executions: Execution[];
  messages: Message[];
  missions: Mission[];
  missionPlanProposals: MissionPlanProposal[];
  policyDecisions: PolicyDecision[];
  tasks: Task[];
  events: DomainEvent[];
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function emptyState(): DurableDomainState {
  return {
    version: 1,
    approvals: [],
    artifacts: [],
    conversations: [],
    executions: [],
    messages: [],
    missions: [],
    missionPlanProposals: [],
    policyDecisions: [],
    tasks: [],
    events: [],
  };
}

function validateState(filePath: string, value: unknown): DurableDomainState {
  if (value === null || typeof value !== "object") {
    throw new Error(`Invalid durable domain snapshot: ${filePath}.`);
  }

  if (!("version" in value) || value.version !== 1) {
    throw new Error(`Unsupported durable domain snapshot version: ${filePath}.`);
  }

  const collectionNames: readonly (keyof Omit<DurableDomainState, "version">)[] = [
    "approvals",
    "artifacts",
    "conversations",
    "executions",
    "messages",
    "missions",
    "missionPlanProposals",
    "policyDecisions",
    "tasks",
    "events",
  ];

  for (const collection of collectionNames) {
    if (!(collection in value) || !Array.isArray(value[collection])) {
      throw new Error(
        `Invalid durable domain collection "${collection}" in ${filePath}.`,
      );
    }
  }

  return clone(value as DurableDomainState);
}

function writeAtomically(filePath: string, state: DurableDomainState): void {
  mkdirSync(dirname(filePath), { recursive: true });

  const tempPath = `${filePath}.${Date.now()}.${randomUUID()}.tmp`;
  writeFileSync(tempPath, JSON.stringify(state) + "\n", "utf8");

  try {
    const fileDescriptor = openSync(tempPath, "r");

    try {
      fsyncSync(fileDescriptor);
    } finally {
      closeSync(fileDescriptor);
    }

    renameSync(tempPath, filePath);
  } catch (error) {
    try {
      unlinkSync(tempPath);
    } catch {
      // Preserve the original persistence error.
    }

    throw error;
  }
}

export class FileDomainDatabase {
  private state: DurableDomainState;

  constructor(private readonly filePath: string) {
    this.state = this.read();
  }

  snapshot(): DurableDomainState {
    return clone(this.state);
  }

  replace(state: DurableDomainState): void {
    const next = validateState(this.filePath, state);
    writeAtomically(this.filePath, next);
    this.state = next;
  }

  get path(): string {
    return this.filePath;
  }

  private read(): DurableDomainState {
    if (!existsSync(this.filePath)) {
      return emptyState();
    }

    return validateState(this.filePath, JSON.parse(readFileSync(this.filePath, "utf8")));
  }
}
