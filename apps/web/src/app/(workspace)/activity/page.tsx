import { getPolyonComposition, sanitizeEventData } from "@/server/polyon-server";

export default function ActivityPage() {
  const events = [...getPolyonComposition().stores.events.list()].reverse().slice(0, 200);

  return (
    <section className="mx-auto max-w-6xl space-y-6">
      <header>
        <div className="text-xs font-medium tracking-[0.18em] text-cyan-300/75">ACTIVITY</div>
        <h1 className="mt-2 text-2xl font-semibold text-white">System trace</h1>
        <p className="mt-2 text-sm leading-6 text-slate-400">
          Reconstruct system actions, policy gates, executions, and resulting records.
        </p>
      </header>
      <section className="rounded-3xl border border-white/8 bg-[#0a0d13]">
        <div className="divide-y divide-white/6">
          {events.length === 0 ? (
            <div className="p-6 text-sm text-slate-500">No domain events recorded.</div>
          ) : (
            events.map((event) => (
              <article key={event.id} className="p-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="text-sm font-medium text-slate-100">
                    {event.kind.replaceAll("_", " ")}
                  </div>
                  <div className="text-[11px] text-slate-600">{event.occurredAt}</div>
                </div>
                <div className="mt-2 flex flex-wrap gap-4 text-[11px] text-slate-600">
                  {event.missionId ? <span>mission {event.missionId}</span> : null}
                  {event.taskId ? <span>task {event.taskId}</span> : null}
                  {event.executionId ? <span>execution {event.executionId}</span> : null}
                </div>
                <pre className="mt-3 overflow-x-auto rounded-2xl bg-black/15 p-3 text-[11px] leading-5 whitespace-pre-wrap text-slate-500">
                  {JSON.stringify(sanitizeEventData(event.data), null, 2)}
                </pre>
              </article>
            ))
          )}
        </div>
      </section>
    </section>
  );
}
