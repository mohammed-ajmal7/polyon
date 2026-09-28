import { getPolyonComposition } from "@/server/polyon-server";

export default function ArtifactsPage() {
  const artifacts = [...getPolyonComposition().stores.artifacts.list()].reverse().slice(0, 100);

  return (
    <section className="mx-auto max-w-6xl space-y-6">
      <header>
        <div className="text-xs font-medium tracking-[0.18em] text-fuchsia-300/75">ARTIFACTS</div>
        <h1 className="mt-2 text-2xl font-semibold text-white">Produced work</h1>
        <p className="mt-2 text-sm leading-6 text-slate-400">
          Durable artifacts retain their mission, task, and execution lineage.
        </p>
      </header>
      <section className="rounded-3xl border border-white/8 bg-[#0a0d13]">
        <div className="border-b border-white/7 px-5 py-4">
          <h2 className="text-sm font-semibold text-white">Artifact catalog</h2>
        </div>
        <div className="divide-y divide-white/6">
          {artifacts.length === 0 ? (
            <div className="p-5 text-sm text-slate-500">No artifacts have been created yet.</div>
          ) : (
            artifacts.map((artifact) => (
              <article key={artifact.id} className="p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-medium text-slate-100">{artifact.name}</div>
                    <div className="mt-1 text-xs text-slate-600">{artifact.id}</div>
                  </div>
                  <span className="rounded-full bg-white/6 px-2.5 py-1 text-[10px] text-slate-300">
                    {artifact.kind}
                  </span>
                </div>
                <div className="mt-4 grid gap-2 text-xs text-slate-600 sm:grid-cols-2">
                  <span>Mission: {artifact.missionId ?? "—"}</span>
                  <span>Task: {artifact.taskId ?? "—"}</span>
                  <span>Location: {artifact.location ?? "metadata only"}</span>
                  <span>Created: {artifact.createdAt}</span>
                </div>
              </article>
            ))
          )}
        </div>
      </section>
    </section>
  );
}
