"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";

import { agentLabel, toRunView, type RunView } from "@/lib/run-result";

type Depth = "Auto" | "Direct" | "Collaborative" | "DeepAnalysis";
type AdvancedMode = "Broadcast" | "Research" | "Debate" | "Mission";
type Mode = Depth | AdvancedMode;

const DEPTHS: readonly { readonly mode: Depth; readonly label: string; readonly hint: string }[] = [
  { mode: "Auto", label: "Auto", hint: "POLYON decides how much of the team to involve." },
  { mode: "Direct", label: "Quick", hint: "One agent answers right away." },
  { mode: "Collaborative", label: "Team", hint: "Several specialists answer, then one synthesis." },
  {
    mode: "DeepAnalysis",
    label: "Deep",
    hint: "Research, challenge, fact-check, debate and judge. Slow on local models.",
  },
];

const ADVANCED: readonly { readonly mode: AdvancedMode; readonly label: string }[] = [
  { mode: "Broadcast", label: "Ask several agents separately" },
  { mode: "Research", label: "Web research (needs a search endpoint)" },
  { mode: "Debate", label: "Structured debate" },
  { mode: "Mission", label: "Plan a multi-step mission" },
];

const MODE_NAMES: Record<string, string> = {
  Direct: "Quick answer",
  Broadcast: "Separate answers",
  Collaborative: "Team answer",
  Research: "Web research",
  DeepAnalysis: "Deep analysis",
  Debate: "Debate",
  Mission: "Mission",
};

const STEP_LABELS: Record<string, string> = {
  COLLECTIVE_STARTED: "Team assembled",
  RESEARCH_STARTED: "Researching sources",
  RESEARCH_FINDING: "A finding came in",
  COLLECTIVE_CONTRIBUTION: "A specialist shared findings",
  COLLECTIVE_CHALLENGE: "Specialists are challenging each other",
  FACT_CHECK_STARTED: "Checking the important claims",
  FACT_CHECK_RESULT: "A claim was checked",
  DEBATE_CONTRIBUTION: "The team is debating",
  COLLECTIVE_SYNTHESIZED: "Writing the answer",
  RESEARCH_SYNTHESIZED: "Writing the answer",
  DEEP_ANALYSIS_COMPLETED: "Finishing up",
};

interface StoredRun {
  readonly runId: string;
  readonly command: string;
  readonly startedAt: number;
}

const RUN_STORAGE_KEY = "polyon.activeRun";

function readStoredRun(): StoredRun | undefined {
  try {
    const raw = window.sessionStorage.getItem(RUN_STORAGE_KEY);
    if (raw === null) return undefined;
    const parsed = JSON.parse(raw) as Partial<StoredRun>;
    return typeof parsed.runId === "string" &&
      typeof parsed.command === "string" &&
      typeof parsed.startedAt === "number"
      ? { runId: parsed.runId, command: parsed.command, startedAt: parsed.startedAt }
      : undefined;
  } catch {
    return undefined;
  }
}

function storeRun(run: StoredRun | undefined): void {
  try {
    if (run === undefined) window.sessionStorage.removeItem(RUN_STORAGE_KEY);
    else window.sessionStorage.setItem(RUN_STORAGE_KEY, JSON.stringify(run));
  } catch {
    // Session storage is a convenience for resuming after reload; the run continues regardless.
  }
}

interface Progress {
  readonly steps: readonly string[];
  readonly messageCount: number;
}

export default function HomePage() {
  const [command, setCommand] = useState("");
  const [mode, setMode] = useState<Mode>("Auto");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [pending, setPending] = useState(false);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [progress, setProgress] = useState<Progress | null>(null);
  const [lastCommand, setLastCommand] = useState<string | null>(null);
  const [view, setView] = useState<RunView | null>(null);
  const [ranMode, setRanMode] = useState<{ mode: string; reason?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [approvalsWaiting, setApprovalsWaiting] = useState(0);
  const conversationRef = useRef<string | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    let cancelled = false;
    async function loadApprovals() {
      try {
        const response = await fetch("/api/approvals", { cache: "no-store" });
        if (!response.ok) return;
        const body = (await response.json()) as { approvals?: unknown[] };
        if (!cancelled) setApprovalsWaiting(body.approvals?.length ?? 0);
      } catch {
        // The banner is advisory; the Approvals page shows the authoritative list.
      }
    }
    void loadApprovals();
    const interval = window.setInterval(() => void loadApprovals(), 10_000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [view]);

  useEffect(() => {
    if (!pending) return;
    const tick = window.setInterval(() => setNow(Date.now()), 1_000);
    const poll = window.setInterval(() => {
      const conversationId = conversationRef.current;
      if (conversationId === null) return;
      void fetch("/api/conversations/" + encodeURIComponent(conversationId), { cache: "no-store" })
        .then((response) => (response.ok ? response.json() : undefined))
        .then((snapshot: { messages?: unknown[]; events?: { kind?: string }[] } | undefined) => {
          if (snapshot === undefined) return;
          const steps = (snapshot.events ?? [])
            .map((event) => STEP_LABELS[event.kind ?? ""])
            .filter((label): label is string => label !== undefined);
          setProgress({ steps, messageCount: snapshot.messages?.length ?? 0 });
        })
        .catch(() => undefined);
    }, 3_000);
    return () => {
      window.clearInterval(tick);
      window.clearInterval(poll);
    };
  }, [pending]);

  // Resume a request that was still running when the page was reloaded.
  useEffect(() => {
    const stored = readStoredRun();
    if (stored !== undefined) void followRun(stored);
    return () => {
      mountedRef.current = false;
    };
  }, []);

  async function followRun(run: StoredRun) {
    conversationRef.current = run.runId;
    setPending(true);
    setStartedAt(run.startedAt);
    setNow(Date.now());
    setLastCommand(run.command);
    try {
      while (mountedRef.current) {
        await new Promise((resolve) => window.setTimeout(resolve, 2_500));
        const response = await fetch("/api/runs/" + encodeURIComponent(run.runId), {
          cache: "no-store",
        });
        if (response.status === 401) {
          window.location.assign("/login");
          return;
        }
        if (response.status === 404) {
          setError(
            "POLYON lost track of this request, probably because the server restarted. " +
              "Anything the team finished is listed under Activity.",
          );
          break;
        }
        if (!response.ok) continue;
        const body = (await response.json()) as {
          status: "running" | "succeeded" | "failed";
          mode: string;
          modeReason?: string;
          result?: unknown;
          error?: string;
        };
        if (body.status === "running") continue;
        setRanMode({
          mode: body.mode,
          ...(body.modeReason === undefined ? {} : { reason: body.modeReason }),
        });
        if (body.status === "failed") setError(body.error ?? "POLYON could not run this request.");
        else setView(toRunView(body.mode, { result: body.result }));
        break;
      }
    } catch {
      setError("POLYON stopped responding while working. Check that it is running.");
    } finally {
      if (mountedRef.current) {
        setPending(false);
        conversationRef.current = null;
        storeRun(undefined);
      }
    }
  }

  async function submit(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    const trimmed = command.trim();
    if (pending || trimmed === "") return;

    const run: StoredRun = { runId: crypto.randomUUID(), command: trimmed, startedAt: Date.now() };
    conversationRef.current = run.runId;
    setPending(true);
    setStartedAt(run.startedAt);
    setNow(Date.now());
    setProgress(null);
    setView(null);
    setRanMode(null);
    setError(null);
    setLastCommand(trimmed);

    try {
      const response = await fetch("/api/execute", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mode,
          command: trimmed,
          conversationId: run.runId,
          async: true,
          ...(mode === "DeepAnalysis" || mode === "Auto" ? { maxDebateRounds: 1 } : {}),
        }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        error?: string;
        mode?: string;
        modeReason?: string;
        result?: unknown;
      };
      if (response.status === 401) {
        window.location.assign("/login");
        return;
      }
      if (!response.ok) {
        setError(body.error ?? "POLYON could not run this request.");
        setPending(false);
        conversationRef.current = null;
        return;
      }
      setCommand("");

      // Vercel executes the request in the foreground because serverless instance memory
      // cannot be relied on for the in-memory background run registry. Render the completed
      // result directly when the route returns 201; local/self-hosted runtimes keep using
      // the resumable 202 + /api/runs/:id flow.
      if (response.status === 201 && body.mode !== undefined) {
        setRanMode({
          mode: body.mode,
          ...(body.modeReason === undefined ? {} : { reason: body.modeReason }),
        });
        setView(toRunView(body.mode, { result: body.result }));
        setPending(false);
        conversationRef.current = null;
        storeRun(undefined);
        return;
      }

      storeRun(run);
      await followRun(run);
    } catch {
      setError("POLYON is not reachable. Check that it is running.");
      setPending(false);
      conversationRef.current = null;
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void submit();
    }
  }

  const elapsed = startedAt === null ? 0 : Math.max(0, Math.floor((now - startedAt) / 1000));

  return (
    <div className="mx-auto max-w-[1180px]">
      {approvalsWaiting > 0 ? (
        <Link
          href="/approvals"
          className="flex items-center justify-between rounded-2xl border border-amber-300/25 bg-amber-300/10 px-4 py-3 text-sm text-amber-100 transition hover:bg-amber-300/15 focus-visible:ring-2 focus-visible:ring-amber-200/60"
        >
          <span>
            {approvalsWaiting === 1
              ? "1 action is waiting for your approval."
              : `${approvalsWaiting} actions are waiting for your approval.`}
          </span>
          <span aria-hidden="true">Review →</span>
        </Link>
      ) : null}

      <section className="mb-8">
        <h1 className="text-3xl font-semibold tracking-[-.03em] text-white sm:text-4xl">
          What are we solving?
        </h1>
        <p className="mt-2 text-sm text-slate-400">
          Ask a question or describe a task. Your AI team works on it, and anything consequential
          waits for your approval.
        </p>

        <div className="polyon-panel polyon-glow overflow-hidden rounded-[28px] mt-6"><form onSubmit={(event) => void submit(event)} className="relative p-4 sm:p-6">
          <label htmlFor="command" className="sr-only">
            Request for POLYON
          </label>
          <div className="relative rounded-2xl border border-white/[.06] bg-black/10 p-3 focus-within:border-violet-300/20 focus-within:ring-1 focus-within:ring-violet-300/20">
            <textarea
              id="command"
              value={command}
              onChange={(event) => setCommand(event.target.value)}
              onKeyDown={onKeyDown}
              disabled={pending}
              rows={3}
              placeholder="Describe the outcome you want…"
              className="w-full resize-none bg-transparent px-1 py-1 text-[18px] leading-8 text-slate-100 outline-none placeholder:text-slate-600 disabled:opacity-60 sm:text-xl"
            />
            <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-white/[.06] pt-4">
              <div
                role="radiogroup"
                aria-label="How much of the team to involve"
                className="flex flex-wrap gap-1"
              >
                {DEPTHS.map((depth) => (
                  <button
                    key={depth.mode}
                    type="button"
                    role="radio"
                    aria-checked={mode === depth.mode}
                    title={depth.hint}
                    disabled={pending}
                    onClick={() => setMode(depth.mode)}
                    className={
                      "rounded-full px-3 py-1.5 text-xs transition focus-visible:ring-2 focus-visible:ring-violet-300/60 disabled:opacity-60 " +
                      (mode === depth.mode
                        ? "bg-violet-300/20 text-violet-100 ring-1 ring-violet-300/40"
                        : "text-slate-300 hover:bg-white/5")
                    }
                  >
                    {depth.label}
                  </button>
                ))}
                <button
                  type="button"
                  aria-expanded={showAdvanced}
                  disabled={pending}
                  onClick={() => setShowAdvanced((value) => !value)}
                  className="rounded-full px-3 py-1.5 text-xs text-slate-400 hover:bg-white/5 focus-visible:ring-2 focus-visible:ring-violet-300/60"
                >
                  {ADVANCED.some((item) => item.mode === mode) ? MODE_NAMES[mode] : "More…"}
                </button>
              </div>
              <button
                type="submit"
                disabled={pending || command.trim() === ""}
                className="ml-auto rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-violet-50 focus-visible:ring-2 focus-visible:ring-violet-300/60 disabled:cursor-not-allowed disabled:opacity-35"
              >
                {pending ? "Working…" : "Send"}
              </button>
            </div>
            {showAdvanced ? (
              <div className="mt-3 grid gap-1 border-t border-white/8 pt-3 sm:grid-cols-2">
                {ADVANCED.map((item) => (
                  <button
                    key={item.mode}
                    type="button"
                    disabled={pending}
                    onClick={() => {
                      setMode(item.mode);
                      setShowAdvanced(false);
                    }}
                    className="rounded-xl px-3 py-2 text-left text-xs text-slate-300 hover:bg-white/5 focus-visible:ring-2 focus-visible:ring-violet-300/60"
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <p className="mt-2 px-2 text-xs text-slate-400">
            {DEPTHS.find((depth) => depth.mode === mode)?.hint ??
              "Advanced mode. Enter sends, Shift+Enter adds a new line."}
          </p>
        </form>
        </div>
      </section>

      {pending ? (
        <section
          aria-live="polite"
          className="rounded-3xl border border-violet-300/15 bg-violet-300/[0.04] p-5"
        >
          <div className="flex items-center gap-3">
            <span
              className="size-2.5 animate-pulse rounded-full bg-violet-300"
              aria-hidden="true"
            />
            <h2 className="text-sm font-medium text-violet-100">POLYON is working…</h2>
            <span className="ml-auto font-mono text-xs text-slate-400">
              {formatElapsed(elapsed)}
            </span>
          </div>
          <p className="mt-2 text-sm text-slate-300">“{lastCommand}”</p>
          <ul className="mt-3 space-y-1 text-sm text-slate-300">
            {(progress?.steps.length ?? 0) === 0 ? (
              <li>Getting the team started.</li>
            ) : (
              collapseSteps(progress?.steps ?? []).map((step) => <li key={step}>✓ {step}</li>)
            )}
          </ul>
          {elapsed > 60 ? (
            <p className="mt-3 text-xs text-slate-400">
              Team and deep requests make many model calls. On a local model this can take several
              minutes; you can leave this page open.
            </p>
          ) : null}
        </section>
      ) : null}

      {error !== null ? (
        <p role="alert" className="rounded-2xl bg-rose-400/10 px-4 py-3 text-sm text-rose-100">
          {error}
        </p>
      ) : null}

      {view !== null ? <AnswerCard view={view} ranMode={ranMode} command={lastCommand} /> : null}
    </div>
  );
}

function AnswerCard({
  view,
  ranMode,
  command,
}: {
  view: RunView;
  ranMode: { mode: string; reason?: string } | null;
  command: string | null;
}) {
  const tone =
    view.outcome === "failed"
      ? "border-rose-300/20"
      : view.outcome === "needs-approval"
        ? "border-amber-300/25"
        : "border-white/10";

  return (
    <article className={"polyon-panel mt-5 rounded-3xl p-5 sm:p-7 " + tone}>
      <header>
        <div className="text-xs text-slate-400">
          {ranMode === null ? null : (MODE_NAMES[ranMode.mode] ?? ranMode.mode)}
          {ranMode?.reason === undefined ? null : <span> · {ranMode.reason}</span>}
        </div>
        {command === null ? null : <p className="mt-1 text-sm text-slate-400">“{command}”</p>}
        <h2 className="mt-3 text-lg font-semibold text-white">{view.headline}</h2>
      </header>

      {view.answer === undefined ? null : (
        <div className="mt-4 text-[15px] leading-7 whitespace-pre-wrap text-slate-100">
          {view.answer}
        </div>
      )}

      {view.approvalsWaiting > 0 ? (
        <Link
          href={view.missionId === undefined ? "/approvals" : "/missions/" + view.missionId}
          className="mt-4 inline-flex rounded-full bg-amber-300/15 px-4 py-2 text-sm text-amber-100 ring-1 ring-amber-300/30 hover:bg-amber-300/20 focus-visible:ring-2"
        >
          Review what POLYON wants to do →
        </Link>
      ) : null}

      {view.confirmed.length > 0 ? (
        <CheckList title="What is confirmed" checks={view.confirmed} />
      ) : null}
      {view.uncertain.length > 0 ? (
        <CheckList title="What is uncertain" checks={view.uncertain} />
      ) : null}

      {view.contributors.length > 0 ? (
        <div className="mt-5">
          <h3 className="text-xs font-medium text-slate-400">Worked on by</h3>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {uniqueBy(view.contributors, (contributor) => contributor.agentId).map(
              (contributor) => (
                <span
                  key={contributor.agentId}
                  className="rounded-full bg-white/5 px-2.5 py-1 text-xs text-slate-300"
                >
                  {contributor.role ?? agentLabel(contributor.agentId)}
                </span>
              ),
            )}
          </div>
        </div>
      ) : null}

      {view.problems.length > 0 ? (
        <details className="mt-5 rounded-2xl bg-white/[0.03] px-4 py-3 text-sm">
          <summary className="cursor-pointer text-slate-300">
            {view.problems.length === 1
              ? "1 part of the team ran into a problem"
              : `${view.problems.length} parts of the team ran into problems`}
          </summary>
          <ul className="mt-2 space-y-1 text-xs text-slate-400">
            {[...new Set(view.problems)].map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        </details>
      ) : null}

      <footer className="mt-5 flex flex-wrap gap-3 text-xs">
        {view.sourceCount > 0 ? (
          <Link href="/evidence" className="text-violet-200 hover:underline">
            View {view.sourceCount} {view.sourceCount === 1 ? "source" : "sources"}
          </Link>
        ) : null}
        {view.conversationId === undefined ? null : (
          <Link href="/activity" className="text-violet-200 hover:underline">
            View how the team worked
          </Link>
        )}
        {view.missionId === undefined ? null : (
          <Link href={"/missions/" + view.missionId} className="text-violet-200 hover:underline">
            Open mission
          </Link>
        )}
      </footer>
    </article>
  );
}

function CheckList({
  title,
  checks,
}: {
  title: string;
  checks: readonly { claim: string; verdict: string; rationale: string }[];
}) {
  return (
    <div className="mt-5">
      <h3 className="text-xs font-medium text-slate-400">{title}</h3>
      <ul className="mt-2 space-y-2">
        {uniqueBy(checks, (check) => check.claim).map((check) => (
          <li key={check.claim} className="rounded-2xl bg-white/[0.03] px-4 py-3 text-sm">
            <p className="line-clamp-3 text-slate-200">{check.claim}</p>
            {check.rationale === "" ? null : (
              <p className="mt-1 text-xs text-slate-400">{check.rationale}</p>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function collapseSteps(steps: readonly string[]): string[] {
  return [...new Set(steps)];
}

function formatElapsed(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  return minutes === 0 ? `${seconds}s` : `${minutes}m ${String(seconds % 60).padStart(2, "0")}s`;
}

function uniqueBy<T>(items: readonly T[], key: (item: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const value = key(item);
    if (seen.has(value)) return false;
    seen.add(value);
    return true;
  });
}
