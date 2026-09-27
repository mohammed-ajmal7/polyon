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
import { createHash, randomUUID } from "node:crypto";
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

import { StorageConcurrencyError } from "./transaction";

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

export interface DurableDomainSnapshot {
  readonly state: DurableDomainState;
  readonly revision: string;
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

function serializeState(state: DurableDomainState): string {
  return JSON.stringify(state) + "\n";
}

function revisionForRaw(raw: string | undefined): string {
  return createHash("sha256")
    .update(raw ?? "<missing>")
    .digest("hex");
}

function validateState(filePath: string, value: unknown): DurableDomainState {
  if (value === null || typeof value !== "object") {
    throw new Error(`Invalid durable domain snapshot: ${filePath}.`);
  }

  if (!("version" in value) || value.version !== 1) {
    throw new Error(`Unsupported durable domain snapshot version: ${filePath}.`);
  }

  const record = value as Record<string, unknown>;
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
    if (!Array.isArray(record[collection])) {
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
  const serialized = serializeState(state);
  writeFileSync(tempPath, serialized, "utf8");

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

function acquireCommitLock(filePath: string): string {
  const lockPath = `${filePath}.lock`;

  try {
    const descriptor = openSync(lockPath, "wx");
    closeSync(descriptor);
    return lockPath;
  } catch {
    throw new StorageConcurrencyError(lockPath);
  }
}

function withCommitLock<T>(filePath: string, work: () => T): T {
  const lockPath = acquireCommitLock(filePath);

  try {
    return work();
  } finally {
    try {
      unlinkSync(lockPath);
    } catch {
      // Preserve the original commit result/error.
    }
  }
}

export class FileDomainDatabase {
  private state: DurableDomainState;
  private revision: string;

  constructor(private readonly filePath: string) {
    const snapshot = this.readSnapshot();
    this.state = snapshot.state;
    this.revision = snapshot.revision;
  }

  snapshot(): DurableDomainState {
    return clone(this.snapshotWithRevision().state);
  }

  snapshotWithRevision(): DurableDomainSnapshot {
    const snapshot = this.readSnapshot();
    this.state = snapshot.state;
    this.revision = snapshot.revision;

    return {
      state: clone(snapshot.state),
      revision: snapshot.revision,
    };
  }

  replace(state: DurableDomainState): string {
    return this.replaceIfRevision(state, this.revision);
  }

  replaceIfRevision(
    state: DurableDomainState,
    expectedRevision: string,
  ): string {
    const next = validateState(this.filePath, state);

    return withCommitLock(this.filePath, () => {
      const currentRevision = this.readCurrentRevision();

      if (currentRevision !== expectedRevision) {
        throw new StorageConcurrencyError(this.filePath);
      }

      writeAtomically(this.filePath, next);
      this.state = clone(next);
      this.revision = revisionForRaw(serializeState(next));

      return this.revision;
    });
  }

  get path(): string {
    return this.filePath;
  }

  private readCurrentRevision(): string {
    if (!existsSync(this.filePath)) {
      return revisionForRaw(undefined);
    }

    return revisionForRaw(readFileSync(this.filePath, "utf8"));
  }

  private readSnapshot(): DurableDomainSnapshot {
    if (!existsSync(this.filePath)) {
      const state = emptyState();

      return {
        state,
        revision: revisionForRaw(undefined),
      };
    }

    const raw = readFileSync(this.filePath, "utf8");

    return {
      state: validateState(this.filePath, JSON.parse(raw)),
      revision: revisionForRaw(raw),
    };
  }
}
