import Link from "next/link";
import { notFound } from "next/navigation";

import { getPolyonComposition, sanitizeEventData } from "@/server/polyon-server";

import { CancelExecutionButton } from "../../missions/[missionId]/cancel-execution-button";

export default async function ExecutionDetailPage({
  params,
}: {
  params: Promise<{ executionId: string }>;
}) {
  const { executionId } = await params;
  const polyon = getPolyonComposition();
  const execution = polyon.stores.executions.get(executionId);
  if (execution === undefined) notFound();

  const task = polyon.stores.tasks.get(execution.taskId);
  const events = polyon.stores.events
    .list()
    .filter((event) => event.executionId === execution.id)
    .reverse();

  return (
    <section className="mx-auto max-w-5xl space-y-6">
      <Link href="/missions" className="text-xs text-slate-500 hover:text-slate-300">
        ← Back to missions
      </Link>

      <header className="rounded-3xl border border-white/8 bg-[#0c1017] p-6">
        <div className="text-xs font-medium tracking-[0.18em] text-cyan-300/75">EXECUTION</div>
        <h1 className="mt-2 text-xl font-semibold text-white">{execution.id}</h1>
        <div className="mt-4 flex flex-wrap gap-2">
          <Tag label={execution.status} />
          <Tag label={"Attempt " + execution.attempt} />
          <Tag label={execution.actorId} />
        </div>
        {execution.status === "QUEUED" || execution.status === "RUNNING" ? (
          <CancelExecutionButton executionId={execution.id} />
        ) : null}
      </header>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-3xl border border-white/8 bg-[#0a0d13] p-5">
          <h2 className="text-sm font-semibold text-white">Task</h2>
          <div className="mt-4 rounded-2xl border border-white/7 bg-white/[0.02] p-4">
            <div className="text-sm text-slate-100">{task?.title ?? execution.taskId}</div>
            <div className="mt-1 text-xs text-slate-600">{execution.taskId}</div>
          </div>
        </section>

        <section className="rounded-3xl border border-white/8 bg-[#0a0d13] p-5">
          <h2 className="text-sm font-semibold text-white">Lifecycle</h2>
          <dl className="mt-4 space-y-3 text-xs">
            <Row label="Mission" value={execution.missionId} />
            <Row label="Created" value={execution.createdAt} />
            <Row label="Updated" value={execution.updatedAt} />
          </dl>
        </section>
      </div>

      <section className="rounded-3xl border border-white/8 bg-[#0a0d13]">
        <div className="border-b border-white/7 px-5 py-4">
          <h2 className="text-sm font-semibold text-white">Execution trace</h2>
        </div>
        <div className="divide-y divide-white/6">
          {events.length === 0 ? (
            <div className="p-5 text-sm text-slate-500">No events recorded for this execution.</div>
          ) : (
            events.map((event) => (
              <div key={event.id} className="p-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs font-medium text-slate-200">
                    {event.kind.replaceAll("_", " ")}
                  </span>
                  <span className="text-[11px] text-slate-600">{event.occurredAt}</span>
                </div>
                <pre className="mt-2 overflow-x-auto text-[11px] leading-5 whitespace-pre-wrap text-slate-500">
                  {JSON.stringify(sanitizeEventData(event.data), null, 2)}
                </pre>
              </div>
            ))
          )}
        </div>
      </section>
    </section>
  );
}

function Tag({ label }: { label: string }) {
  return (
    <span className="inline-flex rounded-full bg-white/6 px-2.5 py-1 text-[10px] text-slate-300">
      {label}
    </span>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 border-b border-white/5 pb-3">
      <dt className="text-slate-600">{label}</dt>
      <dd className="text-right text-slate-300">{value}</dd>
    </div>
  );
}
