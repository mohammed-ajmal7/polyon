import type {
  ConversationId,
  DomainEvent,
  EventId,
  ExecutionId,
  MissionId,
  TaskId,
} from "@polyon/contracts";

import { FileEntityStore, InMemoryEntityStore } from "./entity-store";

export interface EventStore {
  append(event: DomainEvent): void;
  get(eventId: EventId): DomainEvent | undefined;
  list(): readonly DomainEvent[];
  listByConversation(conversationId: ConversationId): readonly DomainEvent[];
  listByMission(missionId: MissionId): readonly DomainEvent[];
  listByTask(taskId: TaskId): readonly DomainEvent[];
  listByExecution(executionId: ExecutionId): readonly DomainEvent[];
}

function cloneEvent(event: DomainEvent): DomainEvent {
  return structuredClone(event);
}

class EntityBackedEventStore implements EventStore {
  constructor(
    private readonly store: InMemoryEntityStore<DomainEvent> | FileEntityStore<DomainEvent>,
  ) {}

  append(event: DomainEvent): void {
    if (this.store.get(event.id) !== undefined) {
      throw new Error(`Event already exists: ${event.id}.`);
    }

    this.store.save(cloneEvent(event));
  }

  get(eventId: EventId): DomainEvent | undefined {
    const event = this.store.get(eventId);

    return event === undefined ? undefined : cloneEvent(event);
  }

  list(): readonly DomainEvent[] {
    return this.store.list().map(cloneEvent);
  }

  listByConversation(conversationId: ConversationId): readonly DomainEvent[] {
    return this.list().filter((event) => event.conversationId === conversationId);
  }

  listByMission(missionId: MissionId): readonly DomainEvent[] {
    return this.list().filter((event) => event.missionId === missionId);
  }

  listByTask(taskId: TaskId): readonly DomainEvent[] {
    return this.list().filter((event) => event.taskId === taskId);
  }

  listByExecution(executionId: ExecutionId): readonly DomainEvent[] {
    return this.list().filter((event) => event.executionId === executionId);
  }
}

export class InMemoryEventStore extends EntityBackedEventStore {
  constructor() {
    super(new InMemoryEntityStore<DomainEvent>());
  }
}

export class FileEventStore extends EntityBackedEventStore {
  constructor(filePath: string) {
    super(new FileEntityStore<DomainEvent>(filePath));
  }
}
