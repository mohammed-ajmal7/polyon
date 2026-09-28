"use client";

import { useState } from "react";

export default function ResearchPage() {
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<unknown>(null);
  const [error, setError] = useState<string | null>(null);

  async function runResearch(synthesize: boolean) {
    setError(null);
    setResult(null);
    const response = await fetch("/api/research", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query, sourceLimit: 10, synthesize }),
    });
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    if (!response.ok) throw new Error(body.error ?? "Research request failed.");
    setResult(body);
  }

  return (
    <section className="mx-auto max-w-6xl space-y-6">
      <header>
        <div className="text-xs font-medium tracking-[0.18em] text-sky-300/75">RESEARCH</div>
        <h1 className="mt-2 text-2xl font-semibold text-white">Evidence-first research</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">
          Gather bounded sources and optionally produce a grounded synthesis.
        </p>
      </header>
      {error ? (
        <div className="rounded-2xl border border-rose-300/15 bg-rose-300/5 p-4 text-sm text-rose-200">
          {error}
        </div>
      ) : null}
      <section className="rounded-3xl border border-white/8 bg-[#0c1017] p-5">
        <textarea
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="What should POLYON research?"
          className="min-h-32 w-full resize-none rounded-2xl border border-white/8 bg-black/20 p-4 text-sm leading-6 text-slate-100 outline-none"
        />
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={!query.trim()}
            onClick={() =>
              void runResearch(false).catch((cause) =>
                setError(cause instanceof Error ? cause.message : "Research failed."),
              )
            }
            className="rounded-xl border border-white/8 bg-white/[0.03] px-4 py-2.5 text-xs text-slate-300 disabled:opacity-40"
          >
            Gather sources
          </button>
          <button
            type="button"
            disabled={!query.trim()}
            onClick={() =>
              void runResearch(true).catch((cause) =>
                setError(cause instanceof Error ? cause.message : "Research failed."),
              )
            }
            className="rounded-xl bg-slate-100 px-4 py-2.5 text-xs font-semibold text-slate-900 disabled:opacity-40"
          >
            Research + synthesize
          </button>
        </div>
      </section>
      {result ? (
        <section className="rounded-3xl border border-white/8 bg-[#0a0d13] p-5">
          <h2 className="text-sm font-semibold text-white">Result</h2>
          <pre className="mt-4 max-h-[60vh] overflow-auto rounded-2xl bg-black/15 p-4 text-xs leading-6 whitespace-pre-wrap text-slate-400">
            {JSON.stringify(result, null, 2)}
          </pre>
        </section>
      ) : null}
    </section>
  );
}
