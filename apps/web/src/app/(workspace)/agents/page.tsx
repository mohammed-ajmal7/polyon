import { getPolyonComposition } from "@/server/polyon-server";

export default function AgentsPage() {
  const polyon = getPolyonComposition();
  const agents = polyon.agents.list();
  const models = polyon.models.list();
  const providers = polyon.providers.list();

  return (
    <section className="mx-auto max-w-6xl space-y-6">
      <header>
        <div className="text-xs font-medium tracking-[0.18em] text-violet-300/75">AGENT FLEET</div>
        <h1 className="mt-2 text-2xl font-semibold text-white">Configured intelligences</h1>
        <p className="mt-2 text-sm leading-6 text-slate-400">
          Models and agents stay replaceable through explicit registries and provider adapters.
        </p>
      </header>

      <div className="grid gap-4 md:grid-cols-3">
        <Stat label="Agents" value={agents.length} />
        <Stat label="Models" value={models.length} />
        <Stat label="Providers" value={providers.length} />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {agents.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-white/10 bg-white/[0.018] p-8 text-sm text-slate-500 md:col-span-2">
            No agents are configured. Add a model endpoint and agent configuration to enable
            provider-backed execution.
          </div>
        ) : (
          agents.map((agent) => (
            <article key={agent.id} className="rounded-3xl border border-white/8 bg-[#0c1017] p-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-sm font-medium text-white">{agent.name}</div>
                  <div className="mt-1 text-xs text-slate-500">{agent.role}</div>
                </div>
                <span className="rounded-full bg-emerald-300/10 px-2.5 py-1 text-[10px] text-emerald-200">
                  {agent.status}
                </span>
              </div>
              <dl className="mt-5 space-y-3 text-xs">
                <Row label="Agent ID" value={agent.id} />
                <Row label="Preferred model" value={agent.preferredModelId ?? "Not configured"} />
                <Row label="Capabilities" value={String(agent.capabilityIds.length)} />
              </dl>
            </article>
          ))
        )}
      </div>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl border border-white/8 bg-white/[0.02] p-4">
      <div className="text-xs text-slate-600">{label}</div>
      <div className="mt-2 text-xl font-semibold text-slate-200">{value}</div>
    </div>
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
