import Link from "next/link";
import { notFound } from "next/navigation";

import { getPolyonComposition } from "@/server/polyon-server";

import { CancelExecutionButton } from "./cancel-execution-button";

export default async function MissionDetailPage({
  params,
}: {
  params: Promise<{ missionId: string }>;
}) {
  const { missionId } = await params;
  const polyon = getPolyonComposition();
  const mission = polyon.stores.missions.get(missionId);

  if (mission === undefined) notFound();

  const tasks = mission.taskIds
    .map((taskId) => polyon.stores.tasks.get(taskId))
    .filter((task): task is NonNullable<typeof task> => task !== undefined);
  const executions = polyon.stores.executions
    .list()
    .filter((execution) => execution.missionId === mission.id)
    .reverse();

  return (
    <section className="mx-auto max-w-6xl space-y-6">
      <Link href="/missions" className="text-xs text-slate-500 hover:text-slate-300">
        ← Back to missions
      </Link>

      <header className="rounded-3xl border border-white/8 bg-[#0c1017] p-6">
        <div className="text-xs font-medium tracking-[0.18em] text-violet-300/75">MISSION</div>
        <h1 className="mt-2 text-2xl font-semibold text-white">{mission.objective}</h1>
        <p className="mt-2 text-xs text-slate-600">{mission.id}</p>
        <div className="mt-5 flex flex-wrap gap-2">
          <Tag label={"Status: " + mission.status} />
          <Tag label={"Tasks: " + tasks.length} />
          <Tag label={"Executions: " + executions.length} />
        </div>
      </header>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
        <section className="rounded-3xl border border-white/8 bg-[#0a0d13]">
          <div className="border-b border-white/7 px-5 py-4">
            <h2 className="text-sm font-semibold text-white">Task graph</h2>
          </div>
          <div className="divide-y divide-white/6">
            {tasks.length === 0 ? (
              <div className="p-5 text-sm text-slate-500">No tasks persisted for this mission.</div>
            ) : (
              tasks.map((task) => (
                <div key={task.id} className="p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-medium text-slate-100">{task.title}</div>
                      <div className="mt-1 text-xs text-slate-600">{task.id}</div>
                    </div>
                    <Tag label={task.status} />
                  </div>
                  {task.dependsOn.length > 0 ? (
                    <div className="mt-3 text-xs text-slate-500">
                      Depends on: {task.dependsOn.join(", ")}
                    </div>
                  ) : null}
                </div>
              ))
            )}
          </div>
        </section>

        <section className="rounded-3xl border border-white/8 bg-[#0a0d13]">
          <div className="border-b border-white/7 px-5 py-4">
            <h2 className="text-sm font-semibold text-white">Executions</h2>
          </div>
          <div className="divide-y divide-white/6">
            {executions.length === 0 ? (
              <div className="p-5 text-sm text-slate-500">No execution attempts yet.</div>
            ) : (
              executions.map((execution) => (
                <div key={execution.id} className="p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <Link
                        href={"/executions/" + execution.id}
                        className="text-sm font-medium text-slate-100 hover:text-white"
                      >
                        {execution.id}
                      </Link>
                      <div className="mt-1 text-xs text-slate-600">
                        Attempt {execution.attempt} · {execution.actorId}
                      </div>
                    </div>
                    <Tag label={execution.status} />
                  </div>
                  {execution.status === "QUEUED" || execution.status === "RUNNING" ? (
                    <CancelExecutionButton executionId={execution.id} />
                  ) : null}
                </div>
              ))
            )}
          </div>
        </section>
      </div>
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
