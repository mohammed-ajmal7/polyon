/**
 * Tracks requests that run in the background after `/api/execute` returns.
 *
 * Local/self-hosted runtimes keep the fast in-memory registry. Vercel uses the
 * durable run-state RPC backed by the existing free Supabase project so a
 * browser reload or a different serverless instance can still observe the run.
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

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

const SUPABASE_URL =
  process.env.POLYON_RUN_STATE_SUPABASE_URL?.trim() ||
  "https://kputedwmsvqdgfmkjkzq.supabase.co";
const SUPABASE_KEY =
  process.env.POLYON_RUN_STATE_SUPABASE_KEY?.trim() ||
  "sb_publishable_kJJa6i4NJlxP42ceGaGLog_7BebV3Ca";

function state(): RegistryState {
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

export async function createPersistentBackgroundRun(
  input: {
    readonly runId: string;
    readonly mode: string;
    readonly modeReason?: string;
    readonly startedAt?: string;
  },
): Promise<BackgroundRun> {
  const run: BackgroundRun = {
    runId: input.runId,
    mode: input.mode,
    ...(input.modeReason === undefined ? {} : { modeReason: input.modeReason }),
    startedAt: input.startedAt ?? new Date().toISOString(),
    status: "running",
  };
  await callRunState("polyon_run_upsert", {
    p_run_id: run.runId,
    p_status: run.status,
    p_mode: run.mode,
    p_mode_reason: run.modeReason ?? null,
    p_started_at: run.startedAt,
    p_finished_at: null,
    p_payload: null,
    p_error: null,
  });
  return run;
}

export async function updatePersistentBackgroundRun(
  run: BackgroundRun,
): Promise<BackgroundRun> {
  await callRunState("polyon_run_upsert", {
    p_run_id: run.runId,
    p_status: run.status,
    p_mode: run.mode,
    p_mode_reason: run.modeReason ?? null,
    p_started_at: run.startedAt,
    p_finished_at: run.finishedAt ?? null,
    p_payload: run.result === undefined ? null : sealPayload(run.result),
    p_error: run.error ?? null,
  });
  return run;
}

export async function getPersistentBackgroundRun(
  runId: string,
): Promise<BackgroundRun | undefined> {
  const rows = await callRunState("polyon_run_get", { p_run_id: runId });
  const row = Array.isArray(rows) ? rows[0] : undefined;
  if (!isRecord(row)) return undefined;

  const result = row.payload === null || row.payload === undefined
    ? undefined
    : openPayload(String(row.payload));

  return {
    runId: String(row.run_id),
    mode: String(row.mode),
    ...(row.mode_reason === null || row.mode_reason === undefined
      ? {}
      : { modeReason: String(row.mode_reason) }),
    startedAt: String(row.started_at),
    status: row.status === "succeeded" || row.status === "failed" ? row.status : "running",
    ...(row.finished_at === null || row.finished_at === undefined
      ? {}
      : { finishedAt: String(row.finished_at) }),
    ...(result === undefined ? {} : { result }),
    ...(row.error === null || row.error === undefined ? {} : { error: String(row.error) }),
  };
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

async function callRunState(functionName: "polyon_run_get" | "polyon_run_upsert", body: Record<string, unknown>) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${functionName}`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  if (!response.ok) {
    const message = await response.text().catch(() => "");
    throw new Error(
      `Durable run state unavailable (${response.status})${message === "" ? "." : `: ${message.slice(0, 300)}`}`,
    );
  }
  return (await response.json()) as unknown;
}

function sealPayload(value: unknown): string {
  const secret = process.env.POLYON_API_TOKEN?.trim();
  if (secret === undefined || secret === "") {
    return `plain.${Buffer.from(JSON.stringify(value), "utf8").toString("base64url")}`;
  }

  const iv = randomBytes(12);
  const key = createHash("sha256").update(secret).digest();
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    "v1",
    iv.toString("base64url"),
    tag.toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

function openPayload(value: string): unknown | undefined {
  try {
    if (value.startsWith("plain.")) {
      return JSON.parse(Buffer.from(value.slice("plain.".length), "base64url").toString("utf8"));
    }

    const secret = process.env.POLYON_API_TOKEN?.trim();
    if (secret === undefined || secret === "") return undefined;

    const [version, ivText, tagText, ciphertextText] = value.split(".");
    if (version !== "v1" || ivText === undefined || tagText === undefined || ciphertextText === undefined) {
      return undefined;
    }

    const key = createHash("sha256").update(secret).digest();
    const decipher = createDecipheriv(
      "aes-256-gcm",
      key,
      Buffer.from(ivText, "base64url"),
    );
    decipher.setAuthTag(Buffer.from(tagText, "base64url"));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(ciphertextText, "base64url")),
      decipher.final(),
    ]).toString("utf8");
    return JSON.parse(plaintext) as unknown;
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
