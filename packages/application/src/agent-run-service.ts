import type {
  AgentRun,
  AgentRunId,
  AgentRunMode,
  AgentRunStatus,
  DomainEvent,
} from "@polyon/contracts";
import type {
  AgentRunStore,
  ConversationStore,
  DomainUnitOfWork,
  EventStore,
  MessageStore,
} from "@polyon/storage";

const MAX_TASK_CHARACTERS = 20_000;
const MAX_AGENTS = 8;

export interface CreateAgentRunInput {
  readonly id: AgentRunId;
  readonly userId: string;
  readonly task: string;
  readonly mode: AgentRunMode;
  readonly agentIds: readonly string[];
  readonly createdAt: string;
}

export interface CompleteAgentRunInput {
  readonly id: AgentRunId;
  readonly finalAnswer: string;
  readonly completedAt: string;
}

export interface FailAgentRunInput {
  readonly id: AgentRunId;
  readonly error: string;
  readonly completedAt: string;
}

export interface AgentRunServiceDependencies {
  readonly agentRuns: AgentRunStore;
  readonly messages: MessageStore;
  readonly events: EventStore;
  readonly conversations: ConversationStore;
  readonly unitOfWork?: DomainUnitOfWork;
}

export class AgentRunService {
  constructor(private readonly dependencies: AgentRunServiceDependencies) {}

  create(input: CreateAgentRunInput): AgentRun {
    validateCreateInput(input);

    if (this.dependencies.agentRuns.get(input.id) !== undefined) {
      throw new Error(`Agent run already exists: ${input.id}.`);
    }

    const run: AgentRun = {
      id: input.id,
      userId: input.userId.trim(),
      task: input.task.trim(),
      mode: input.mode,
      status: "queued",
      agentIds: [...new Set(input.agentIds)],
      messageIds: [],
      evidenceIds: [],
      executionIds: [],
      approvalIds: [],
      toolInvocationIds: [],
      artifactIds: [],
      createdAt: input.createdAt,
      updatedAt: input.createdAt,
    };

    const operation = (stores: Pick<AgentRunServiceDependencies, "agentRuns" | "events">): AgentRun => {
      stores.agentRuns.save(run);
      stores.events.append({
        id: `AGENT_RUN_CREATED:${run.id}`,
        kind: "AGENT_RUN_CREATED",
        agentRunId: run.id,
        actorId: run.userId,
        occurredAt: run.createdAt,
        data: {
          runId: run.id,
          mode: run.mode,
          agentIds: [...run.agentIds],
        },
      });
      return run;
    };

    return this.withStores(operation);
  }

  start(id: AgentRunId, startedAt: string): AgentRun {
    return this.transition(id, "running", startedAt);
  }

  complete(input: CompleteAgentRunInput): AgentRun {
    const finalAnswer = input.finalAnswer.trim();
    if (finalAnswer.length === 0) {
      throw new RangeError("Completed agent run requires a final answer.");
    }

    return this.transition(input.id, "completed", input.completedAt, {
      finalAnswer,
    });
  }

  fail(input: FailAgentRunInput): AgentRun {
    const error = input.error.trim();
    if (error.length === 0) {
      throw new RangeError("Failed agent run requires an error.");
    }

    return this.transition(input.id, "failed", input.completedAt, {
      error,
    });
  }

  get(id: AgentRunId): AgentRun | undefined {
    return this.dependencies.agentRuns.get(id);
  }

  listByUser(userId: string): readonly AgentRun[] {
    return this.dependencies.agentRuns
      .list()
      .filter((run) => run.userId === userId.trim())
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  syncMessageIds(id: AgentRunId): AgentRun {
    return this.withStores((stores) => {
      const run = stores.agentRuns.get(id);
      if (run === undefined) {
        throw new Error(`Agent run not found: ${id}.`);
      }

      const messageIds = stores.messages
        .list()
        .filter((message) => message.runId === id)
        .map((message) => message.id);

      const next = {
        ...run,
        messageIds,
        updatedAt: new Date().toISOString(),
      };
      stores.agentRuns.save(next);
      return next;
    });
  }

  private transition(
    id: AgentRunId,
    nextStatus: AgentRunStatus,
    occurredAt: string,
    patch: { readonly finalAnswer?: string; readonly error?: string } = {},
  ): AgentRun {
    const operation = (
      stores: Pick<AgentRunServiceDependencies, "agentRuns" | "events">,
    ): AgentRun => {
      const current = stores.agentRuns.get(id);
      if (current === undefined) {
        throw new Error(`Agent run not found: ${id}.`);
      }

      validateTransition(current.status, nextStatus);

      const next: AgentRun = {
        ...current,
        status: nextStatus,
        ...(nextStatus === "running" ? { startedAt: occurredAt } : {}),
        ...(nextStatus === "completed" || nextStatus === "failed"
          ? { completedAt: occurredAt }
          : {}),
        ...(patch.finalAnswer === undefined ? {} : { finalAnswer: patch.finalAnswer }),
        ...(patch.error === undefined ? {} : { error: patch.error }),
        updatedAt: occurredAt,
      };

      stores.agentRuns.save(next);

      const event: DomainEvent = {
        id: `AGENT_RUN_STATUS_CHANGED:${id}:${nextStatus}:${occurredAt}`,
        kind: "AGENT_RUN_STATUS_CHANGED",
        agentRunId: id,
        actorId: current.userId,
        occurredAt,
        data: {
          runId: id,
          previousStatus: current.status,
          status: nextStatus,
        },
      };
      stores.events.append(event);

      return next;
    };

    return this.withStores(operation);
  }

  private withStores<T>(
    work: (
      stores: Pick<AgentRunServiceDependencies, "agentRuns" | "events">,
    ) => T,
  ): T {
    if (this.dependencies.unitOfWork === undefined) {
      return work(this.dependencies);
    }

    return this.dependencies.unitOfWork.transaction(work);
  }
}

function validateCreateInput(input: CreateAgentRunInput): void {
  if (input.id.trim().length === 0) throw new RangeError("Agent run id must not be empty.");
  if (input.userId.trim().length === 0) throw new RangeError("Agent run userId must not be empty.");

  const task = input.task.trim();
  if (task.length === 0 || task.length > MAX_TASK_CHARACTERS) {
    throw new RangeError(
      `Agent run task must contain 1-${MAX_TASK_CHARACTERS} characters.`,
    );
  }

  if (!Number.isInteger(input.agentIds.length) || input.agentIds.length > MAX_AGENTS) {
    throw new RangeError(`Agent run must contain at most ${MAX_AGENTS} agents.`);
  }

  if (new Set(input.agentIds).size !== input.agentIds.length) {
    throw new Error("Agent run agentIds must be unique.");
  }
}

function validateTransition(current: AgentRunStatus, next: AgentRunStatus): void {
  const allowed =
    (current === "queued" && next === "running") ||
    (current === "running" && (next === "completed" || next === "failed"));

  if (!allowed) {
    throw new Error(`Invalid agent run transition: ${current} -> ${next}.`);
  }
}
