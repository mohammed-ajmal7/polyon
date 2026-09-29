import { executionEnabled, getPolyonComposition, getPolyonPolicy } from "@/server/polyon-server";

function isConfigured(value: string | undefined) {
  return value !== undefined && value.trim() !== "";
}

export default function SettingsPage() {
  const polyon = getPolyonComposition();
  const policy = getPolyonPolicy();

  const rows = [
    ["Execution", executionEnabled() ? "Enabled" : "Disabled"],
    ["Approval mode", policy.approvalMode],
    [
      "API authentication",
      isConfigured(process.env.POLYON_API_TOKEN) ? "Configured" : "Open/local",
    ],
    [
      "Models",
      polyon.models.list().length === 0
        ? "Not configured"
        : polyon.models
            .list()
            .map((model) => model.name)
            .join(", "),
    ],
    ["Team members", String(polyon.agents.list().length)],
    [
      "Embedding provider",
      isConfigured(process.env.POLYON_EMBEDDING_ENDPOINT) ? "Configured" : "Not configured",
    ],
    ["Research provider", polyon.research ? "Configured" : "Not configured"],
    ["Creative providers", polyon.creative ? "Configured" : "Not configured"],
    [
      "Semantic auto-index scopes",
      process.env.POLYON_SEMANTIC_INDEX_ALLOWED_SCOPES?.trim() || "Disabled",
    ],
    [
      "Runtime autostart",
      process.env.POLYON_RUNTIME_AUTOSTART === "false" ? "Disabled" : "Enabled",
    ],
    ["Data directory", process.env.POLYON_DATA_DIR?.trim() || ".polyon-data"],
  ];

  return (
    <section className="mx-auto max-w-5xl space-y-6">
      <header>
        <div className="text-xs font-medium tracking-[0.18em] text-slate-400">SETTINGS</div>
        <h1 className="mt-2 text-2xl font-semibold text-white">Runtime configuration</h1>
        <p className="mt-2 text-sm leading-6 text-slate-400">
          Configuration state is visible here; secret values are never rendered.
        </p>
      </header>

      <section className="rounded-3xl border border-white/8 bg-[#0a0d13]">
        <div className="divide-y divide-white/6">
          {rows.map(([label, value]) => (
            <div
              key={label}
              className="flex flex-col gap-2 p-5 sm:flex-row sm:items-center sm:justify-between"
            >
              <span className="text-sm text-slate-400">{label}</span>
              <span className="max-w-xl text-sm break-words text-slate-200">{value}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-3xl border border-amber-300/10 bg-amber-300/[0.025] p-5">
        <div className="text-sm font-medium text-amber-100">Release safety</div>
        <p className="mt-2 text-xs leading-5 text-amber-100/55">
          Keep execution disabled and ASK_EVERYTHING until the real deployment smoke test has
          verified the model, tools, integrations, approvals, persistence, and recovery.
        </p>
      </section>
    </section>
  );
}
