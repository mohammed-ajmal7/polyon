"use client";

import { useEffect, useState } from "react";

interface Approval {
  readonly id: string;
  readonly action: string;
  readonly riskLevel: string;
  readonly reason: string;
  readonly requestedAt: string;
  readonly missionId?: string;
  readonly taskId?: string;
  readonly executionId?: string;
  readonly toolId?: string;
  readonly integrationId?: string;
}

export default function ApprovalsPage() {
  const [approvals, setApprovals] = useState<readonly Approval[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    const response = await fetch("/api/approvals", { cache: "no-store" });
    const body = (await response.json().catch(() => ({}))) as {
      approvals?: Approval[];
      error?: string;
    };
    if (!response.ok) throw new Error(body.error ?? "Unable to load approvals.");
    setApprovals(body.approvals ?? []);
  }

  useEffect(() => {
    void refresh().catch((cause) =>
      setError(cause instanceof Error ? cause.message : "Unable to load approvals."),
    );
  }, []);

  async function resolve(approvalId: string, status: "APPROVED" | "REJECTED") {
    setError(null);
    const response = await fetch("/api/approvals", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ approvalId, status }),
    });
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    if (!response.ok) throw new Error(body.error ?? "Approval resolution failed.");
    await refresh();
  }

  return (
    <section className="mx-auto max-w-5xl space-y-6">
      <header>
        <div className="text-xs font-medium tracking-[0.18em] text-amber-300/75">APPROVALS</div>
        <h1 className="mt-2 text-2xl font-semibold text-white">Human decision inbox</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">
          Consequential work waits here until you explicitly approve or reject it.
        </p>
      </header>

      {error ? (
        <div className="rounded-2xl border border-rose-300/15 bg-rose-300/5 p-4 text-sm text-rose-200">
          {error}
        </div>
      ) : null}

      {approvals.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-white/10 bg-white/[0.018] p-8 text-sm text-slate-500">
          Nothing is waiting for a human decision.
        </div>
      ) : (
        <div className="space-y-4">
          {approvals.map((approval) => (
            <article
              key={approval.id}
              className="rounded-3xl border border-white/8 bg-[#0c1017] p-5"
            >
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <div className="text-sm font-medium text-white">{approval.action}</div>
                  <div className="mt-1 text-xs text-slate-600">{approval.id}</div>
                </div>
                <span className="rounded-full bg-amber-300/10 px-2.5 py-1 text-[10px] text-amber-200">
                  {approval.riskLevel}
                </span>
              </div>
              <p className="mt-4 text-sm leading-6 text-slate-400">{approval.reason}</p>
              <div className="mt-4 grid gap-2 text-xs text-slate-600 sm:grid-cols-2">
                <span>Requested: {approval.requestedAt}</span>
                {approval.executionId ? <span>Execution: {approval.executionId}</span> : null}
                {approval.taskId ? <span>Task: {approval.taskId}</span> : null}
                {approval.toolId ? <span>Tool: {approval.toolId}</span> : null}
                {approval.integrationId ? <span>Integration: {approval.integrationId}</span> : null}
              </div>
              <div className="mt-5 flex gap-2">
                <button
                  type="button"
                  onClick={() =>
                    void resolve(approval.id, "APPROVED").catch((cause) =>
                      setError(cause instanceof Error ? cause.message : "Approval failed."),
                    )
                  }
                  className="rounded-xl bg-slate-100 px-4 py-2.5 text-xs font-semibold text-slate-900"
                >
                  Approve
                </button>
                <button
                  type="button"
                  onClick={() =>
                    void resolve(approval.id, "REJECTED").catch((cause) =>
                      setError(cause instanceof Error ? cause.message : "Rejection failed."),
                    )
                  }
                  className="rounded-xl border border-white/8 bg-white/[0.03] px-4 py-2.5 text-xs font-medium text-slate-300"
                >
                  Reject
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
