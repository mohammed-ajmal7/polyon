import type {
  Artifact,
  Execution,
  Mission,
  Task,
} from "@polyon/contracts";

import {
  InMemoryEntityStore,
  type EntityStore,
} from "./entity-store";

export type MissionStore = EntityStore<Mission>;
export type TaskStore = EntityStore<Task>;
export type ExecutionStore = EntityStore<Execution>;
export type ArtifactStore = EntityStore<Artifact>;

export interface DomainStores {
  readonly missions: MissionStore;
  readonly tasks: TaskStore;
  readonly executions: ExecutionStore;
  readonly artifacts: ArtifactStore;
}

export class InMemoryDomainStores implements DomainStores {
  readonly missions: MissionStore = new InMemoryEntityStore<Mission>();
  readonly tasks: TaskStore = new InMemoryEntityStore<Task>();
  readonly executions: ExecutionStore = new InMemoryEntityStore<Execution>();
  readonly artifacts: ArtifactStore = new InMemoryEntityStore<Artifact>();
}
