import { getPolyonComposition } from "@/server/polyon-server";

export default function EvidencePage() {
  const polyon = getPolyonComposition();
  const evidence = [...polyon.stores.evidence.list()].reverse().slice(0, 100);
  const sources = [...polyon.stores.sources.list()].reverse().slice(0, 100);

  return (
    <section className="mx-auto max-w-6xl space-y-6">
      <header>
        <div className="text-xs font-medium tracking-[0.18em] text-sky-300/75">EVIDENCE</div>
        <h1 className="mt-2 text-2xl font-semibold text-white">Sources and evidence</h1>
        <p className="mt-2 text-sm leading-6 text-slate-400">
          Inspect provenance behind research instead of treating model output as a source.
        </p>
      </header>
      <div className="grid gap-6 xl:grid-cols-2">
        <Collection title="Sources" empty="No sources recorded." isEmpty={sources.length === 0}>
          {sources.map((source) => (
            <article key={source.id} className="p-5">
              <div className="text-sm font-medium text-slate-100">{source.title}</div>
              <div className="mt-1 text-xs break-all text-slate-600">{source.locator}</div>
              <div className="mt-3 text-[11px] text-slate-600">{source.id}</div>
            </article>
          ))}
        </Collection>
        <Collection title="Evidence" empty="No evidence recorded." isEmpty={evidence.length === 0}>
          {evidence.map((item) => (
            <article key={item.id} className="p-5">
              <div className="text-sm font-medium text-slate-100">{item.claim}</div>
              <div className="mt-2 text-xs leading-5 text-slate-500">{item.supportingContent}</div>
              <div className="mt-3 text-[11px] text-slate-600">{item.id}</div>
            </article>
          ))}
        </Collection>
      </div>
    </section>
  );
}

function Collection({
  title,
  empty,
  isEmpty,
  children,
}: {
  title: string;
  empty: string;
  isEmpty: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-3xl border border-white/8 bg-[#0a0d13]">
      <div className="border-b border-white/7 px-5 py-4">
        <h2 className="text-sm font-semibold text-white">{title}</h2>
      </div>
      <div className="divide-y divide-white/6">
        {isEmpty ? <div className="p-5 text-sm text-slate-400">{empty}</div> : children}
      </div>
    </section>
  );
}
