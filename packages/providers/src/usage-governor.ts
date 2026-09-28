export type UsageCostClass = "free" | "paid" | "unknown";

export interface UsageBudget {
  readonly providerId: string;
  readonly dailyRequestLimit?: number;
  readonly monthlyRequestLimit?: number;
  readonly maxTokensPerRun?: number;
  readonly maxAgentsPerRun?: number;
  readonly maxDebateRounds?: number;
}

export interface UsageInvocationContext {
  readonly runId?: string;
  readonly agentId?: string;
  readonly agentCount?: number;
  readonly debateRound?: number;
  readonly costClass?: UsageCostClass;
}

export interface UsageAuthorizationRequest {
  readonly providerId: string;
  readonly modelId: string;
  readonly estimatedTokens?: number;
  readonly context?: UsageInvocationContext;
}

export interface ProviderUsageSnapshot {
  readonly providerId: string;
  readonly day: string;
  readonly month: string;
  readonly dailyRequests: number;
  readonly monthlyRequests: number;
}

export interface RunUsageSnapshot {
  readonly runId: string;
  readonly providerId: string;
  readonly tokens: number;
  readonly agents: number;
  readonly debateRounds: number;
}

export type UsageGovernorErrorKind =
  | "PAID_MODEL_BLOCKED"
  | "DAILY_REQUEST_LIMIT"
  | "MONTHLY_REQUEST_LIMIT"
  | "RUN_TOKEN_LIMIT"
  | "RUN_AGENT_LIMIT"
  | "DEBATE_ROUND_LIMIT";

export class UsageGovernorError extends Error {
  readonly kind: UsageGovernorErrorKind;
  readonly providerId: string;
  readonly modelId: string;

  constructor(
    kind: UsageGovernorErrorKind,
    providerId: string,
    modelId: string,
    message: string,
  ) {
    super(message);
    this.name = "UsageGovernorError";
    this.kind = kind;
    this.providerId = providerId;
    this.modelId = modelId;
  }
}

export interface UsageReservation {
  complete(actualTokens?: number): void;
}

interface ProviderCounter {
  day: string;
  month: string;
  dailyRequests: number;
  monthlyRequests: number;
}

interface RunCounter {
  tokens: number;
  reservedTokens: number;
  agents: Set<string>;
  maxDebateRoundSeen: number;
}

export interface UsageGovernorOptions {
  readonly costMode?: "configured" | "zero";
  readonly budgets?: readonly UsageBudget[];
  readonly now?: () => string;
}

export class UsageGovernor {
  private readonly costMode: "configured" | "zero";
  private readonly budgets: ReadonlyMap<string, UsageBudget>;
  private readonly now: () => string;
  private readonly providers = new Map<string, ProviderCounter>();
  private readonly runs = new Map<string, RunCounter>();

  constructor(options: UsageGovernorOptions = {}) {
    this.costMode = options.costMode ?? "configured";
    this.budgets = new Map((options.budgets ?? []).map((budget) => [budget.providerId, budget]));
    this.now = options.now ?? (() => new Date().toISOString());
  }

  authorize(request: UsageAuthorizationRequest): UsageReservation {
    const context = request.context;
    const costClass = context?.costClass ?? "unknown";

    if (this.costMode === "zero" && costClass !== "free") {
      throw new UsageGovernorError(
        "PAID_MODEL_BLOCKED",
        request.providerId,
        request.modelId,
        `Zero-cost mode blocked model ${request.modelId} because its cost class is ${costClass}.`,
      );
    }

    const budget = this.budgets.get(request.providerId);
    const counter = this.providerCounter(request.providerId);
    const runId = context?.runId;
    const estimatedTokens = Math.max(0, Math.floor(request.estimatedTokens ?? 0));
    const runCounter = runId === undefined ? undefined : this.runCounter(runId, request.providerId);

    if (
      budget?.dailyRequestLimit !== undefined &&
      counter.dailyRequests >= budget.dailyRequestLimit
    ) {
      throw new UsageGovernorError(
        "DAILY_REQUEST_LIMIT",
        request.providerId,
        request.modelId,
        `Daily model request limit reached for provider ${request.providerId}.`,
      );
    }

    if (
      budget?.monthlyRequestLimit !== undefined &&
      counter.monthlyRequests >= budget.monthlyRequestLimit
    ) {
      throw new UsageGovernorError(
        "MONTHLY_REQUEST_LIMIT",
        request.providerId,
        request.modelId,
        `Monthly model request limit reached for provider ${request.providerId}.`,
      );
    }

    if (
      budget?.maxTokensPerRun !== undefined &&
      runCounter !== undefined &&
      runCounter.tokens + runCounter.reservedTokens + estimatedTokens > budget.maxTokensPerRun
    ) {
      throw new UsageGovernorError(
        "RUN_TOKEN_LIMIT",
        request.providerId,
        request.modelId,
        `Per-run token limit reached for provider ${request.providerId}.`,
      );
    }

    if (
      budget?.maxAgentsPerRun !== undefined &&
      context?.agentCount !== undefined &&
      context.agentCount > budget.maxAgentsPerRun
    ) {
      throw new UsageGovernorError(
        "RUN_AGENT_LIMIT",
        request.providerId,
        request.modelId,
        `Per-run agent limit exceeded for provider ${request.providerId}.`,
      );
    }

    if (
      budget?.maxAgentsPerRun !== undefined &&
      runCounter !== undefined &&
      context?.agentId !== undefined &&
      !runCounter.agents.has(context.agentId) &&
      runCounter.agents.size >= budget.maxAgentsPerRun
    ) {
      throw new UsageGovernorError(
        "RUN_AGENT_LIMIT",
        request.providerId,
        request.modelId,
        `Per-run agent limit reached for provider ${request.providerId}.`,
      );
    }

    if (
      budget?.maxDebateRounds !== undefined &&
      context?.debateRound !== undefined &&
      context.debateRound > budget.maxDebateRounds
    ) {
      throw new UsageGovernorError(
        "DEBATE_ROUND_LIMIT",
        request.providerId,
        request.modelId,
        `Debate round limit reached for provider ${request.providerId}.`,
      );
    }

    counter.dailyRequests += 1;
    counter.monthlyRequests += 1;

    if (runCounter !== undefined) {
      runCounter.reservedTokens += estimatedTokens;
      if (context?.agentId !== undefined) {
        runCounter.agents.add(context.agentId);
      }
      if (context?.debateRound !== undefined) {
        runCounter.maxDebateRoundSeen = Math.max(
          runCounter.maxDebateRoundSeen,
          context.debateRound,
        );
      }
    }

    let completed = false;
    return {
      complete: (actualTokens?: number) => {
        if (completed) return;
        completed = true;

        if (runCounter === undefined) return;

        runCounter.reservedTokens = Math.max(0, runCounter.reservedTokens - estimatedTokens);
        const tokens = actualTokens === undefined ? estimatedTokens : Math.max(0, actualTokens);
        runCounter.tokens += Math.floor(tokens);
      },
    };
  }

  providerSnapshot(providerId: string): ProviderUsageSnapshot {
    const counter = this.providerCounter(providerId);
    const date = this.now();
    return {
      providerId,
      day: counter.day,
      month: counter.month,
      dailyRequests: counter.dailyRequests,
      monthlyRequests: counter.monthlyRequests,
    };
  }

  runSnapshot(runId: string, providerId: string): RunUsageSnapshot {
    const counter = this.runCounter(runId, providerId);
    return {
      runId,
      providerId,
      tokens: counter.tokens + counter.reservedTokens,
      agents: counter.agents.size,
      debateRounds: counter.maxDebateRoundSeen,
    };
  }

  private providerCounter(providerId: string): ProviderCounter {
    const date = this.now();
    const day = date.slice(0, 10);
    const month = date.slice(0, 7);
    const current = this.providers.get(providerId);

    if (current?.day === day && current.month === month) return current;

    const next: ProviderCounter = {
      day,
      month,
      dailyRequests: current?.day === day ? current.dailyRequests : 0,
      monthlyRequests: current?.month === month ? current.monthlyRequests : 0,
    };
    this.providers.set(providerId, next);
    return next;
  }

  private runCounter(runId: string, providerId: string): RunCounter {
    const key = `${providerId}:${runId}`;
    const current = this.runs.get(key);

    if (current !== undefined) return current;

    const next: RunCounter = {
      tokens: 0,
      reservedTokens: 0,
      agents: new Set<string>(),
      maxDebateRoundSeen: 0,
    };
    this.runs.set(key, next);
    return next;
  }
}
