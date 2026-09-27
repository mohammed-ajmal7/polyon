import type { DomainEvent, EventId, ExecutionId, MissionId, TaskId } from "@polyon/contracts";

export interface EventStore {
  append(event: DomainEvent): void;
  get(eventId: EventId): DomainEvent | undefined;
  list(): readonly DomainEvent[];
  listByMission(missionId: MissionId): readonly DomainEvent[];
  listByTask(taskId: TaskId): readonly DomainEvent[];
  listByExecution(executionId: ExecutionId): readonly DomainEvent[];
}

function cloneEvent(event: DomainEvent): DomainEvent {
  return structuredClone(event);
}

export class InMemoryEventStore implements EventStore {
  private readonly events = new Map<EventId, DomainEvent>();

  append(event: DomainEvent): void {
    if (this.events.has(event.id)) {
      throw new Error(`Event already exists: ${event.id}.`);
    }

    this.events.set(event.id, cloneEvent(event));
  }

  get(eventId: EventId): DomainEvent | undefined {
    const event = this.events.get(eventId);

    return event === undefined ? undefined : cloneEvent(event);
  }

  list(): readonly DomainEvent[] {
    return [...this.events.values()].map(cloneEvent);
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
