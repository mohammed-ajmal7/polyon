"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type Mode = "Direct" | "Broadcast" | "Debate" | "Mission";
type ActivityKind = "SYSTEM" | "APPROVAL" | "EXECUTION" | "AGENT";

interface Overview {
  readonly actorId: string;
  readonly agents: readonly AgentSummary[];
  readonly approvals: readonly ApprovalSummary[];
  readonly counts: Record<
    | "executions"
    | "queued"
    | "active"
    | "memories"
    | "sources"
    | "evidence"
    | "debates"
    | "artifacts"
    | "events",
    number
  >;
  readonly activity: readonly ActivityEvent[];
}
interface AgentSummary {
  readonly id: string;
  readonly name: string;
  readonly role: string;
  readonly status: string;
  readonly preferredModelId?: string;
}
interface ApprovalSummary {
  readonly id: string;
  readonly action: string;
  readonly riskLevel: string;
  readonly reason: string;
  readonly requestedAt: string;
}
interface ActivityEvent {
  readonly id: string;
  readonly kind: string;
  readonly occurredAt: string;
  readonly data: Readonly<Record<string, unknown>>;
}

function statusClass(status: string) {
  if (status === "ACTIVE") return "bg-emerald-400/10 text-emerald-300 ring-1 ring-emerald-400/20";
  if (status === "READY") return "bg-sky-400/10 text-sky-300 ring-1 ring-sky-400/20";
  return "bg-amber-400/10 text-amber-300 ring-1 ring-amber-400/20";
}

function activityDot(kind: ActivityKind) {
  if (kind === "APPROVAL") return "bg-amber-300";
  if (kind === "EXECUTION") return "bg-cyan-300";
  if (kind === "AGENT") return "bg-violet-300";
  return "bg-slate-300";
}

function eventKind(kind: string): ActivityKind {
  if (kind.includes("APPROVAL")) return "APPROVAL";
  if (kind.includes("EXECUTION")) return "EXECUTION";
  if (kind.includes("AGENT") || kind.includes("MODEL")) return "AGENT";
  return "SYSTEM";
}

function formatTime(value: string) {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed)
    ? new Date(parsed).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : value;
}

function summarize(data: Readonly<Record<string, unknown>>) {
  const entries = Object.entries(data).slice(0, 2);
  return entries.length === 0
    ? "Recorded domain activity."
    : entries.map(([key, value]) => key + ": " + String(value)).join(" · ");
}

export default function Home() {
  const [mode, setMode] = useState<Mode>("Mission");
  const [command, setCommand] = useState("");
  const [overview, setOverview] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [authRequired, setAuthRequired] = useState(false);
  const [authToken, setAuthToken] = useState("");
  const [lastExecution, setLastExecution] = useState<string | null>(null);
  const agents = overview?.agents ?? [];
  const approvals = overview?.approvals ?? [];
  const counts = overview?.counts ?? {
    executions: 0,
    queued: 0,
    active: 0,
    memories: 0,
    sources: 0,
    evidence: 0,
    debates: 0,
    artifacts: 0,
    events: 0,
  };
  const selectedAgent = agents[0];

  const modeDescription = useMemo(() => {
    if (mode === "Direct") return "Work with one intelligence at a time.";
    if (mode === "Broadcast") return "Send one request to multiple agents independently.";
    if (mode === "Debate")
      return "Run a bounded proposal, criticism, evidence and adjudication flow.";
    return "Turn a larger objective into governed, executable work.";
  }, [mode]);

  async function refreshOverview() {
    const response = await fetch("/api/overview", { cache: "no-store" });
    if (response.status === 401) {
      setAuthRequired(true);
      return;
    }
    if (!response.ok) throw new Error("Unable to load the POLYON overview.");
    setAuthRequired(false);
    setOverview((await response.json()) as Overview);
  }

  async function login() {
    setError(null);
    const response = await fetch("/api/auth", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: authToken }),
    });
    if (!response.ok) {
      setError("Authentication failed.");
      return;
    }
    setAuthToken("");
    setAuthRequired(false);
    await refreshOverview();
  }

  useEffect(() => {
    void refreshOverview().catch((cause) =>
      setError(cause instanceof Error ? cause.message : "Overview unavailable."),
    );
    const interval = window.setInterval(() => {
      void refreshOverview().catch(() => undefined);
    }, 5000);
    return () => window.clearInterval(interval);
  }, []);

  async function submitCommand() {
    const trimmed = command.trim();
    if (!trimmed) return;
    setError(null);
    const response = await fetch("/api/execute", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode, command: trimmed }),
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? "Execution submission failed.");
    }
    const result = (await response.json().catch(() => ({}))) as { result?: { status?: string } };
    setLastExecution(result.result?.status ?? "SUBMITTED");
    setCommand("");
    await refreshOverview();
  }

  async function resolveApproval(approvalId: string, status: "APPROVED" | "REJECTED") {
    setError(null);
    const response = await fetch("/api/approvals", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ approvalId, status }),
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? "Approval resolution failed.");
    }
    await refreshOverview();
  }

  const activities = (overview?.activity ?? []).map((event) => ({
    ...event,
    activityKind: eventKind(event.kind),
  }));

  return (
    <>
      {authRequired ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-[#05070a]/95 px-5">
          <div className="w-full max-w-md rounded-3xl border border-white/10 bg-[#0c1017] p-6 shadow-2xl">
            <div className="text-xs font-medium tracking-[0.18em] text-violet-300/80">
              PRIVATE AI HQ
            </div>
            <h2 className="mt-2 text-xl font-semibold text-white">Authentication required</h2>
            <p className="mt-2 text-sm leading-6 text-slate-500">
              Enter the server access token configured by the POLYON operator.
            </p>
            <input
              type="password"
              value={authToken}
              onChange={(event) => setAuthToken(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void login();
              }}
              className="mt-5 w-full rounded-xl border border-white/8 bg-black/20 px-3 py-3 text-sm text-slate-100 outline-none focus:border-violet-300/25"
              placeholder="POLYON API token"
              autoFocus
            />
            <button
              type="button"
              onClick={() => void login()}
              className="mt-3 w-full rounded-xl bg-slate-100 px-4 py-3 text-xs font-semibold text-slate-900"
            >
              Unlock POLYON
            </button>
          </div>
        </div>
      ) : null}
      <main className="min-h-screen bg-[#07090d] text-slate-100">
        <div className="mx-auto flex min-h-screen max-w-[1600px]">
          <aside className="hidden w-72 shrink-0 border-r border-white/8 bg-[#090c12] px-5 py-6 lg:flex lg:flex-col">
            <div className="flex items-center gap-3">
              <div className="grid size-10 place-items-center rounded-2xl border border-violet-300/15 bg-violet-300/8 text-sm font-semibold tracking-widest text-violet-200">
                P
              </div>
              <div>
                <div className="text-sm font-semibold tracking-[0.2em]">POLYON</div>
                <div className="text-xs text-slate-500">Personal AI Operations Network</div>
              </div>
            </div>
            <div className="mt-8 rounded-2xl border border-white/8 bg-white/[0.025] p-4">
              <div className="text-[11px] font-medium tracking-[0.18em] text-slate-500">
                OPERATING MODE
              </div>
              <div className="mt-3 flex items-center gap-2">
                <span className="size-2 rounded-full bg-emerald-300" />
                <span className="text-sm text-slate-200">Human controlled</span>
              </div>
              <p className="mt-2 text-xs leading-5 text-slate-500">
                Policy gates remain ahead of consequential execution.
              </p>
            </div>
            <nav className="mt-8 space-y-1.5">
              {[
                ["Command", "/"],
                ["Missions", "/missions"],
                ["Approvals", "/approvals"],
                ["Agents", "/agents"],
                ["Memory", "/memory"],
                ["Research", "/research"],
                ["Artifacts", "/artifacts"],
                ["Evidence", "/evidence"],
                ["Activity", "/activity"],
                ["Settings", "/settings"],
              ].map(([item, href]) => (
                <Link
                  key={item}
                  href={href}
                  className="flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-sm text-slate-400 transition hover:bg-white/[0.035] hover:text-slate-200"
                >
                  <span>{item}</span>
                  {item === "Activity" ? (
                    <span className="rounded-full bg-white/7 px-2 py-0.5 text-[10px] text-slate-400">
                      {activities.length}
                    </span>
                  ) : null}
                </Link>
              ))}
            </nav>
            <div className="mt-auto border-t border-white/8 pt-4 text-xs text-slate-600">
              v0.1 release-candidate workspace
            </div>
          </aside>

          <section className="flex min-w-0 flex-1 flex-col">
            <header className="border-b border-white/8 bg-[#080b10]/90 px-5 py-4 backdrop-blur-xl sm:px-7">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <div className="text-xs font-medium tracking-[0.18em] text-violet-300/80">
                    AI OPERATIONS HQ
                  </div>
                  <h1 className="mt-1 text-xl font-semibold tracking-tight text-white sm:text-2xl">
                    One command. Many intelligences.
                  </h1>
                </div>
                <div className="flex items-center gap-3">
                  <div className="hidden rounded-xl border border-white/8 bg-white/[0.025] px-3 py-2 text-xs text-slate-400 md:block">
                    {overview?.actorId ?? "local-user"} · live
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      void fetch("/api/auth", { method: "DELETE" }).then(() =>
                        window.location.reload(),
                      )
                    }
                    className="rounded-xl border border-white/8 bg-white/[0.025] px-3 py-2 text-xs text-slate-400 transition hover:bg-white/7 hover:text-slate-200"
                  >
                    Log out
                  </button>
                  <div className="grid size-10 place-items-center rounded-xl border border-white/8 bg-white/[0.025] text-sm font-medium text-slate-300">
                    HQ
                  </div>
                </div>
              </div>
            </header>

            <div className="flex-1 overflow-y-auto px-5 py-6 sm:px-7 lg:px-8">
              {error ? (
                <div className="mb-5 rounded-2xl border border-rose-300/15 bg-rose-300/5 px-4 py-3 text-sm text-rose-200">
                  {error}
                </div>
              ) : null}
              {lastExecution ? (
                <div className="mb-5 rounded-2xl border border-cyan-300/10 bg-cyan-300/5 px-4 py-3 text-sm text-cyan-100">
                  Last governed submission: {lastExecution}
                </div>
              ) : null}
              <div className="grid gap-6 xl:grid-cols-[minmax(0,1.55fr)_minmax(340px,0.75fr)]">
                <div className="space-y-6">
                  <section className="overflow-hidden rounded-3xl border border-white/10 bg-[#0d111a] shadow-2xl shadow-black/20">
                    <div className="border-b border-white/7 px-5 py-5 sm:px-6">
                      <div className="flex flex-wrap items-start justify-between gap-4">
                        <div>
                          <div className="text-xs font-medium tracking-[0.16em] text-slate-500">
                            COMMAND CENTER
                          </div>
                          <h2 className="mt-2 text-lg font-semibold text-white">
                            What should POLYON do?
                          </h2>
                          <p className="mt-1 max-w-2xl text-sm text-slate-400">{modeDescription}</p>
                        </div>
                        <div className="rounded-xl border border-emerald-300/10 bg-emerald-300/5 px-3 py-2 text-xs text-emerald-200">
                          {selectedAgent?.name ?? "No agent configured"}
                        </div>
                      </div>
                      <div className="mt-5 flex flex-wrap gap-2">
                        {(["Direct", "Broadcast", "Debate", "Mission"] as Mode[]).map((entry) => (
                          <button
                            key={entry}
                            type="button"
                            aria-pressed={mode === entry}
                            onClick={() => setMode(entry)}
                            className={
                              "rounded-xl px-3.5 py-2 text-xs font-medium transition " +
                              (mode === entry
                                ? "bg-violet-300/15 text-violet-100 ring-1 ring-violet-300/30"
                                : "bg-white/[0.03] text-slate-400 ring-1 ring-white/8 hover:bg-white/7 hover:text-slate-200")
                            }
                          >
                            {entry}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="p-5 sm:p-6">
                      <textarea
                        value={command}
                        onChange={(event) => setCommand(event.target.value)}
                        onKeyDown={(event) => {
                          if ((event.metaKey || event.ctrlKey) && event.key === "Enter")
                            void submitCommand().catch((cause) =>
                              setError(
                                cause instanceof Error
                                  ? cause.message
                                  : "Command submission failed.",
                              ),
                            );
                        }}
                        placeholder="Give POLYON a command..."
                        className="min-h-36 w-full resize-none rounded-2xl border border-white/8 bg-black/20 p-4 text-sm leading-6 text-slate-100 outline-none placeholder:text-slate-600 focus:border-violet-300/25 focus:ring-4 focus:ring-violet-300/5"
                      />
                      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                        <div className="text-xs text-slate-600">
                          ⌘↵ to run · governed execution path
                        </div>
                        <button
                          type="button"
                          onClick={() =>
                            void submitCommand().catch((cause) =>
                              setError(
                                cause instanceof Error
                                  ? cause.message
                                  : "Command submission failed.",
                              ),
                            )
                          }
                          className="rounded-xl bg-slate-100 px-4 py-2.5 text-xs font-semibold text-slate-900 transition hover:bg-white"
                        >
                          Submit command
                        </button>
                      </div>
                    </div>
                  </section>

                  <section className="rounded-3xl border border-white/8 bg-[#0a0d13]">
                    <div className="flex items-center justify-between border-b border-white/7 px-5 py-4 sm:px-6">
                      <div>
                        <div className="text-xs font-medium tracking-[0.16em] text-slate-500">
                          SYSTEM COUNTS
                        </div>
                        <h2 className="mt-1 text-base font-semibold text-white">
                          Live operating state
                        </h2>
                      </div>
                    </div>
                    <div className="grid gap-3 p-5 sm:grid-cols-3 sm:p-6">
                      {[
                        ["Queued", counts.queued],
                        ["Active", counts.active],
                        ["Approvals", approvals.length],
                        ["Memories", counts.memories],
                        ["Sources", counts.sources],
                        ["Artifacts", counts.artifacts],
                      ].map(([label, value]) => (
                        <div
                          key={String(label)}
                          className="rounded-2xl border border-white/7 bg-white/[0.02] p-4"
                        >
                          <div className="text-xs text-slate-600">{label}</div>
                          <div className="mt-2 text-lg font-semibold text-slate-200">
                            {String(value)}
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>

                  <section className="rounded-3xl border border-white/8 bg-[#0a0d13]">
                    <div className="flex items-center justify-between border-b border-white/7 px-5 py-4 sm:px-6">
                      <div>
                        <div className="text-xs font-medium tracking-[0.16em] text-slate-500">
                          AGENT FLEET
                        </div>
                        <h2 className="mt-1 text-base font-semibold text-white">
                          Configured intelligences
                        </h2>
                      </div>
                      <span className="text-xs text-slate-600">{agents.length} registered</span>
                    </div>
                    <div className="grid gap-3 p-5 sm:grid-cols-2 sm:p-6">
                      {agents.length === 0 ? (
                        <div className="rounded-2xl border border-dashed border-white/8 p-5 text-sm text-slate-500">
                          No provider-backed agents are configured on this server yet.
                        </div>
                      ) : (
                        agents.map((agent) => (
                          <div
                            key={agent.id}
                            className="rounded-2xl border border-white/7 bg-white/[0.018] p-4"
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <div className="text-sm font-medium text-slate-100">
                                  {agent.name}
                                </div>
                                <div className="mt-1 text-xs text-slate-500">{agent.role}</div>
                              </div>
                              <span
                                className={
                                  "rounded-full px-2 py-1 text-[10px] " + statusClass(agent.status)
                                }
                              >
                                {agent.status}
                              </span>
                            </div>
                            <div className="mt-4 border-t border-white/7 pt-3 text-xs text-slate-600">
                              {agent.preferredModelId ?? "No model bound"}
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </section>
                </div>

                <div className="space-y-6">
                  <section className="rounded-3xl border border-white/8 bg-[#0a0d13]">
                    <div className="border-b border-white/7 px-5 py-4">
                      <div className="text-xs font-medium tracking-[0.16em] text-slate-500">
                        EXECUTION QUEUE
                      </div>
                      <div className="mt-1 flex items-center justify-between">
                        <h2 className="text-base font-semibold text-white">Governed work</h2>
                        <span className="text-xs text-slate-600">
                          {counts.queued + counts.active} active/queued
                        </span>
                      </div>
                    </div>
                    <div className="divide-y divide-white/7">
                      {[
                        ["Queued executions", counts.queued],
                        ["Active executions", counts.active],
                        ["Pending approvals", approvals.length],
                      ].map(([title, value]) => (
                        <div key={String(title)} className="px-5 py-4">
                          <div className="flex items-center justify-between gap-3">
                            <div className="text-sm text-slate-200">{title}</div>
                            <span className="rounded-full bg-white/[0.035] px-2 py-1 text-[10px] text-slate-500 ring-1 ring-white/7">
                              {String(value)}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>

                  <section className="rounded-3xl border border-amber-300/10 bg-[#0a0d13]">
                    <div className="border-b border-white/7 px-5 py-4">
                      <div className="text-xs font-medium tracking-[0.16em] text-amber-300/70">
                        APPROVAL INBOX
                      </div>
                      <h2 className="mt-1 text-base font-semibold text-white">Human decisions</h2>
                    </div>
                    <div className="divide-y divide-white/7">
                      {approvals.length === 0 ? (
                        <div className="px-5 py-5 text-sm text-slate-600">
                          No pending approvals.
                        </div>
                      ) : (
                        approvals.slice(0, 6).map((approval) => (
                          <div key={approval.id} className="px-5 py-4">
                            <div className="text-sm text-slate-200">{approval.action}</div>
                            <div className="mt-1 text-xs leading-5 text-slate-500">
                              {approval.reason}
                            </div>
                            <div className="mt-3 flex gap-2">
                              <button
                                type="button"
                                onClick={() =>
                                  void resolveApproval(approval.id, "APPROVED").catch((cause) =>
                                    setError(
                                      cause instanceof Error ? cause.message : "Approval failed.",
                                    ),
                                  )
                                }
                                className="rounded-lg bg-emerald-300/10 px-3 py-1.5 text-[11px] text-emerald-200"
                              >
                                Approve
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  void resolveApproval(approval.id, "REJECTED").catch((cause) =>
                                    setError(
                                      cause instanceof Error ? cause.message : "Approval failed.",
                                    ),
                                  )
                                }
                                className="rounded-lg bg-rose-300/10 px-3 py-1.5 text-[11px] text-rose-200"
                              >
                                Reject
                              </button>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </section>

                  <section className="rounded-3xl border border-white/8 bg-[#0a0d13]">
                    <div className="border-b border-white/7 px-5 py-4">
                      <div className="text-xs font-medium tracking-[0.16em] text-slate-500">
                        SYSTEM ACTIVITY
                      </div>
                      <div className="mt-1 flex items-center justify-between">
                        <h2 className="text-base font-semibold text-white">Live trace</h2>
                        <span className="text-xs text-slate-600">append-only view</span>
                      </div>
                    </div>
                    <div className="p-5">
                      <div className="space-y-5">
                        {activities.length === 0 ? (
                          <div className="text-sm text-slate-600">No activity recorded yet.</div>
                        ) : (
                          activities.slice(0, 8).map((activity) => (
                            <div key={activity.id} className="flex gap-3">
                              <div className="mt-1.5 flex size-5 shrink-0 items-center justify-center">
                                <span
                                  className={
                                    "size-2 rounded-full " + activityDot(activity.activityKind)
                                  }
                                />
                              </div>
                              <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="text-sm font-medium text-slate-200">
                                    {activity.kind.replaceAll("_", " ")}
                                  </span>
                                  <span className="text-[11px] text-slate-600">
                                    {formatTime(activity.occurredAt)}
                                  </span>
                                </div>
                                <p className="mt-1 text-xs leading-5 text-slate-500">
                                  {summarize(activity.data)}
                                </p>
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  </section>

                  <section className="rounded-3xl border border-violet-300/10 bg-violet-300/[0.025] p-5">
                    <div className="text-sm font-medium text-violet-100">Knowledge + evidence</div>
                    <div className="mt-2 grid grid-cols-3 gap-2 text-xs text-slate-500">
                      <span>{counts.memories} memories</span>
                      <span>{counts.sources} sources</span>
                      <span>{counts.evidence} evidence</span>
                    </div>
                  </section>
                  <section className="rounded-3xl border border-amber-300/10 bg-amber-300/[0.025] p-5">
                    <div className="flex items-start gap-3">
                      <div className="grid size-9 shrink-0 place-items-center rounded-xl bg-amber-300/10 text-amber-200">
                        !
                      </div>
                      <div>
                        <div className="text-sm font-medium text-amber-100">Human authority</div>
                        <p className="mt-1 text-xs leading-5 text-amber-100/55">
                          POLYON coordinates work, but consequential actions remain behind policy
                          and approval controls.
                        </p>
                      </div>
                    </div>
                  </section>
                </div>
              </div>
            </div>
          </section>
        </div>
      </main>
    </>
  );
}
