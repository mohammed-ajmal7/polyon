"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { agentLabel } from "@/lib/run-result";

interface Approval {
  readonly id: string;
  readonly action: string;
  readonly riskLevel: string;
  readonly reason: string;
  readonly requestedAt: string;
  readonly missionId?: string;
  readonly preview?: {
    readonly title: string;
    readonly detail?: string;
    readonly input?: string;
    readonly requestedFor?: string;
    readonly agentId?: string;
  };
}

type LoadState = "loading" | "ready" | "signed-out" | "error";

const RISK_STYLES: Record<string, string> = {
  LOW: "bg-emerald-300/10 text-emerald-200 ring-emerald-300/25",
  MEDIUM: "bg-amber-300/10 text-amber-200 ring-amber-300/25",
  HIGH: "bg-rose-300/10 text-rose-200 ring-rose-300/30",
};

export default function ApprovalsPage() {
  const [approvals, setApprovals] = useState<readonly Approval[]>([]);
  const [state, setState] = useState<LoadState>("loading");
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function refresh() {
    const response = await fetch("/api/approvals", { cache: "no-store" });
    if (response.status === 401) {
      setState("signed-out");
      return;
    }
    const body = (await response.json().catch(() => ({}))) as {
      approvals?: Approval[];
      error?: string;
    };
    if (!response.ok) throw new Error(body.error ?? "Unable to load approvals.");
    setApprovals(body.approvals ?? []);
    setState("ready");
  }

  useEffect(() => {
    const load = () =>
      void refresh().catch((cause: unknown) => {
        setState((current) => (current === "loading" ? "error" : current));
        setError(cause instanceof Error ? cause.message : "Unable to load approvals.");
      });
    load();
    const interval = window.setInterval(load, 5_000);
    return () => window.clearInterval(interval);
  }, []);

  async function resolve(approval: Approval, status: "APPROVED" | "REJECTED") {
    if (busyId !== null) return;
    if (
      status === "APPROVED" &&
      approval.riskLevel === "HIGH" &&
      !window.confirm(
        `Approve this high-risk action?\n\n${approval.preview?.title ?? approval.action}`,
      )
    ) {
      return;
    }
    setBusyId(approval.id);
    setError(null);
    try {
      const response = await fetch("/api/approvals", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ approvalId: approval.id, status }),
      });
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "POLYON could not record your decision.");
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "POLYON could not record your decision.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="mx-auto max-w-3xl space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-white">Approvals</h1>
        <p className="mt-2 text-sm leading-6 text-slate-400">
          POLYON asks here before it does anything you have not already allowed. Nothing below
          happens until you approve it.
        </p>
      </header>

      {error !== null ? (
        <p role="alert" className="rounded-2xl bg-rose-400/10 px-4 py-3 text-sm text-rose-100">
          {error}
        </p>
      ) : null}

      {state === "loading" ? (
        <p className="text-sm text-slate-400" aria-live="polite">
          Loading approvals…
        </p>
      ) : state === "signed-out" ? (
        <p className="rounded-2xl bg-white/[0.03] px-4 py-3 text-sm text-slate-300">
          Your session has ended.{" "}
          <Link href="/login" className="text-violet-200 underline">
            Sign in again
          </Link>
          .
        </p>
      ) : approvals.length === 0 && state === "ready" ? (
        <div className="rounded-3xl border border-dashed border-white/10 bg-white/[0.02] p-8 text-sm text-slate-400">
          Nothing is waiting for you.
        </div>
      ) : (
        <ul className="space-y-4">
          {approvals.map((approval) => (
            <li key={approval.id} className="rounded-3xl border border-white/10 bg-[#0c1017] p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="text-base font-medium text-white">
                    {approval.preview?.title ?? approval.action}
                  </h2>
                  <p className="mt-1 text-xs text-slate-400">
                    {approval.preview?.agentId === undefined
                      ? null
                      : `Requested by ${agentLabel(approval.preview.agentId)} · `}
                    {relativeTime(approval.requestedAt)}
                  </p>
                </div>
                <span
                  className={
                    "rounded-full px-2.5 py-1 text-xs ring-1 " +
                    (RISK_STYLES[approval.riskLevel] ?? RISK_STYLES.MEDIUM)
                  }
                >
                  {approval.riskLevel.toLowerCase()} risk
                </span>
              </div>

              {approval.preview?.requestedFor === undefined ? null : (
                <p className="mt-4 text-sm text-slate-300">
                  <span className="text-slate-400">While working on: </span>“
                  {approval.preview.requestedFor}”
                </p>
              )}

              {approval.preview?.input === undefined ? null : (
                <details className="mt-3 rounded-2xl bg-black/30 px-4 py-3" open>
                  <summary className="cursor-pointer text-xs text-slate-400">
                    Exactly what it will use
                  </summary>
                  <pre className="mt-2 max-h-64 overflow-auto font-mono text-xs leading-5 break-words whitespace-pre-wrap text-slate-200">
                    {approval.preview.input}
                  </pre>
                </details>
              )}

              <p className="mt-3 text-xs leading-5 text-slate-400">{approval.reason}</p>

              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={busyId !== null}
                  onClick={() => void resolve(approval, "APPROVED")}
                  className="rounded-xl bg-slate-100 px-4 py-2.5 text-sm font-semibold text-slate-900 hover:bg-white focus-visible:ring-2 focus-visible:ring-violet-300/60 disabled:opacity-50"
                >
                  {busyId === approval.id ? "Saving…" : "Approve"}
                </button>
                <button
                  type="button"
                  disabled={busyId !== null}
                  onClick={() => void resolve(approval, "REJECTED")}
                  className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2.5 text-sm text-slate-200 hover:bg-white/[0.06] focus-visible:ring-2 focus-visible:ring-violet-300/60 disabled:opacity-50"
                >
                  Reject
                </button>
                {approval.missionId === undefined ? null : (
                  <Link
                    href={"/missions/" + approval.missionId}
                    className="self-center text-xs text-violet-200 hover:underline"
                  >
                    Open mission
                  </Link>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function relativeTime(value: string): string {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return value;
  const seconds = Math.round((Date.now() - time) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return new Date(time).toLocaleString();
}
