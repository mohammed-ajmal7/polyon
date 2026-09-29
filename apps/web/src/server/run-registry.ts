/**
 * Tracks requests that run in the background after `/api/execute` returns, so a long team or
 * deep run survives page reloads and HTTP timeouts. State is kept in server memory: results
 * are also persisted in the run's conversation, but a restart forgets in-flight run status.
 */

export type BackgroundRunStatus = "running" | "succeeded" | "failed";

export interface BackgroundRun {
  readonly runId: string;
  readonly mode: string;
  readonly modeReason?: string;
  readonly startedAt: string;
  readonly status: BackgroundRunStatus;
  readonly finishedAt?: string;
  readonly result?: unknown;
  readonly error?: string;
}

export const MAX_ACTIVE_BACKGROUND_RUNS = 4;
const MAX_RETAINED_RUNS = 50;

interface RegistryState {
  readonly runs: Map<string, BackgroundRun>;
}

function state(): RegistryState {
  // Route modules may be instantiated separately; share one registry per server process.
  const holder = globalThis as typeof globalThis & { __polyonBackgroundRuns?: RegistryState };
  holder.__polyonBackgroundRuns ??= { runs: new Map() };
  return holder.__polyonBackgroundRuns;
}

export class BackgroundRunLimitError extends Error {}

export function activeBackgroundRunCount(): number {
  let active = 0;
  for (const run of state().runs.values()) if (run.status === "running") active += 1;
  return active;
}

export function startBackgroundRun(
  input: { readonly runId: string; readonly mode: string; readonly modeReason?: string },
  work: () => Promise<unknown>,
  now: () => string = () => new Date().toISOString(),
): BackgroundRun {
  const { runs } = state();
  if (runs.get(input.runId)?.status === "running") {
    throw new BackgroundRunLimitError(`Run ${input.runId} is already running.`);
  }
  if (activeBackgroundRunCount() >= MAX_ACTIVE_BACKGROUND_RUNS) {
    throw new BackgroundRunLimitError(
      `POLYON is already working on ${MAX_ACTIVE_BACKGROUND_RUNS} requests. Wait for one to finish.`,
    );
  }

  const run: BackgroundRun = {
    runId: input.runId,
    mode: input.mode,
    ...(input.modeReason === undefined ? {} : { modeReason: input.modeReason }),
    startedAt: now(),
    status: "running",
  };
  runs.set(run.runId, run);
  evictFinished(runs);

  void Promise.resolve()
    .then(work)
    .then(
      (result) => runs.set(run.runId, { ...run, status: "succeeded", finishedAt: now(), result }),
      (error: unknown) =>
        runs.set(run.runId, {
          ...run,
          status: "failed",
          finishedAt: now(),
          error: error instanceof Error ? error.message : "The request failed.",
        }),
    );

  return run;
}

export function getBackgroundRun(runId: string): BackgroundRun | undefined {
  return state().runs.get(runId);
}

function evictFinished(runs: Map<string, BackgroundRun>): void {
  if (runs.size <= MAX_RETAINED_RUNS) return;
  for (const [id, run] of runs) {
    if (runs.size <= MAX_RETAINED_RUNS) break;
    if (run.status !== "running") runs.delete(id);
  }
}

/** Test helper: forget every tracked run. */
export function resetBackgroundRuns(): void {
  state().runs.clear();
}
