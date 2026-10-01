import type { DomainEvent } from "@polyon/contracts";
import type { EventStore } from "@polyon/storage";

export interface TraceQuery {
  readonly missionId?: string;
  readonly taskId?: string;
  readonly executionId?: string;
  readonly agentRunId?: string;
  readonly conversationId?: string;
  readonly limit?: number;
}

export interface TraceEvent {
  readonly id: string;
  readonly kind: DomainEvent["kind"];
  readonly occurredAt: string;
  readonly actorId?: string;
  readonly missionId?: string;
  readonly taskId?: string;
  readonly executionId?: string;
  readonly agentRunId?: string;
  readonly conversationId?: string;
  readonly data: Readonly<Record<string, unknown>>;
}

export class TraceQueryService {
  constructor(private readonly events: EventStore) {}

  list(query: TraceQuery = {}): readonly TraceEvent[] {
    const limit = query.limit ?? 100;
    if (!Number.isInteger(limit) || limit <= 0 || limit > 500) {
      throw new RangeError("Trace query limit must be an integer between 1 and 500.");
    }

    return this.events
      .list()
      .filter((event) => query.missionId === undefined || event.missionId === query.missionId)
      .filter((event) => query.taskId === undefined || event.taskId === query.taskId)
      .filter((event) => query.executionId === undefined || event.executionId === query.executionId)
      .filter((event) => query.agentRunId === undefined || event.agentRunId === query.agentRunId)
      .filter(
        (event) =>
          query.conversationId === undefined || event.conversationId === query.conversationId,
      )
      .sort(
        (left, right) =>
          left.occurredAt.localeCompare(right.occurredAt) || left.id.localeCompare(right.id),
      )
      .slice(-limit)
      .map((event) => ({
        id: event.id,
        kind: event.kind,
        occurredAt: event.occurredAt,
        actorId: event.actorId,
        missionId: event.missionId,
        taskId: event.taskId,
        executionId: event.executionId,
        agentRunId: event.agentRunId,
        conversationId: event.conversationId,
        data: redactTraceData(event.data),
      }));
  }
}

function redactTraceData(
  data: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  const safe: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    const normalized = key.toLowerCase();
    if (
      normalized.includes("secret") ||
      normalized.includes("password") ||
      normalized.includes("token") ||
      normalized.includes("credential") ||
      normalized.includes("authorization")
    )
      continue;
    safe[key] = value;
  }
  return safe;
}
