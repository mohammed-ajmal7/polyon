import Link from "next/link";

import { getPolyonComposition } from "@/server/polyon-server";

function statusClass(status: string) {
  if (status === "RUNNING") return "bg-cyan-300/10 text-cyan-200";
  if (status === "COMPLETED") return "bg-emerald-300/10 text-emerald-200";
  if (status === "FAILED") return "bg-rose-300/10 text-rose-200";
  return "bg-white/6 text-slate-300";
}

export default function MissionsPage() {
  const polyon = getPolyonComposition();
  const missions = [...polyon.stores.missions.list()].reverse();

  return (
    <section className="mx-auto max-w-6xl space-y-6">
      <header>
        <div className="text-xs font-medium tracking-[0.18em] text-violet-300/75">MISSIONS</div>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-white">Operational work</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">
          Inspect objectives, task graphs, executions, and outcomes without leaving the governed
          execution system.
        </p>
      </header>

      {missions.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-white/10 bg-white/[0.018] p-8 text-sm text-slate-500">
          No missions yet. Use the Command page to create one.
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {missions.map((mission) => {
            const tasks = mission.taskIds
              .map((taskId) => polyon.stores.tasks.get(taskId))
              .filter((task): task is NonNullable<typeof task> => task !== undefined);
            const executions = polyon.stores.executions
              .list()
              .filter((execution) => execution.missionId === mission.id);
            const events = polyon.stores.events
              .list()
              .filter((event) => event.missionId === mission.id);

            return (
              <Link
                key={mission.id}
                href={"/missions/" + mission.id}
                className="rounded-3xl border border-white/8 bg-[#0c1017] p-5 transition hover:border-violet-300/20 hover:bg-[#0e131d]"
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="text-sm font-medium text-white">{mission.objective}</div>
                    <div className="mt-2 text-xs text-slate-600">{mission.id}</div>
                  </div>
                  <span
                    className={
                      "rounded-full px-2.5 py-1 text-[10px] " + statusClass(mission.status)
                    }
                  >
                    {mission.status}
                  </span>
                </div>
                <div className="mt-5 grid grid-cols-3 gap-2">
                  <Stat label="Tasks" value={tasks.length} />
                  <Stat label="Executions" value={executions.length} />
                  <Stat label="Events" value={events.length} />
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl border border-white/7 bg-white/[0.02] p-3">
      <div className="text-[11px] text-slate-600">{label}</div>
      <div className="mt-1 text-base font-semibold text-slate-200">{value}</div>
    </div>
  );
}
