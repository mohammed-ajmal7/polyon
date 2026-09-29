"use client";

import { FormEvent, useEffect, useState } from "react";

interface Memory {
  readonly id: string;
  readonly kind: string;
  readonly scope: string;
  readonly text: string;
  readonly createdAt: string;
}

export default function MemoryPage() {
  const [query, setQuery] = useState("");
  const [memories, setMemories] = useState<readonly Memory[]>([]);
  const [text, setText] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function searchMemory(searchQuery: string) {
    const response = await fetch(
      "/api/memory?limit=50&q=" + encodeURIComponent(searchQuery),
      {
        cache: "no-store",
      },
    );
    const body = (await response.json().catch(() => ({}))) as {
      memories?: Memory[];
      error?: string;
    };
    if (!response.ok) throw new Error(body.error ?? "Memory search failed.");
    setMemories(body.memories ?? []);
  }

  async function search() {
    await searchMemory(query);
  }

  useEffect(() => {
    void searchMemory("").catch((cause) =>
      setError(cause instanceof Error ? cause.message : "Memory search failed."),
    );
  }, []);

  async function save(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setMessage(null);
    const response = await fetch("/api/memory", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: "memory-" + crypto.randomUUID(),
        kind: "SUMMARY",
        scope: "PRIVATE",
        text,
        tags: [],
        sourceIds: [],
      }),
    });
    const body = (await response.json().catch(() => ({}))) as {
      result?: { status?: string };
      error?: string;
    };
    if (!response.ok) throw new Error(body.error ?? "Memory write failed.");
    setText("");
    setMessage(
      body.result?.status === "APPROVAL_REQUIRED" ? "Waiting for approval." : "Memory saved.",
    );
    await search();
  }

  return (
    <section className="mx-auto max-w-6xl space-y-6">
      <header>
        <div className="text-xs font-medium tracking-[0.18em] text-violet-300/75">MEMORY</div>
        <h1 className="mt-2 text-2xl font-semibold text-white">Private knowledge</h1>
        <p className="mt-2 text-sm leading-6 text-slate-400">
          Search durable memory and record new knowledge through the governed memory path.
        </p>
      </header>
      {error ? <Banner tone="error">{error}</Banner> : null}
      {message ? <Banner tone="info">{message}</Banner> : null}
      <div className="grid gap-6 xl:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
        <form
          onSubmit={(event) =>
            void save(event).catch((cause) =>
              setError(cause instanceof Error ? cause.message : "Memory write failed."),
            )
          }
          className="rounded-3xl border border-white/8 bg-[#0c1017] p-5"
        >
          <h2 className="text-sm font-semibold text-white">Remember something</h2>
          <p className="mt-1 text-xs leading-5 text-slate-500">
            Writes remain subject to policy and approval.
          </p>
          <textarea
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder="A fact, preference, decision, or summary..."
            className="mt-4 min-h-40 w-full resize-none rounded-2xl border border-white/8 bg-black/20 p-4 text-sm leading-6 text-slate-100 outline-none"
          />
          <button
            type="submit"
            disabled={!text.trim()}
            className="mt-3 rounded-xl bg-slate-100 px-4 py-2.5 text-xs font-semibold text-slate-900 disabled:opacity-40"
          >
            Save memory
          </button>
        </form>

        <section className="rounded-3xl border border-white/8 bg-[#0a0d13]">
          <div className="flex gap-2 border-b border-white/7 p-4">
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter")
                  void search().catch((cause) =>
                    setError(cause instanceof Error ? cause.message : "Search failed."),
                  );
              }}
              placeholder="Search memory"
              className="min-w-0 flex-1 rounded-xl border border-white/8 bg-black/20 px-3 py-2.5 text-sm text-slate-100 outline-none"
            />
            <button
              type="button"
              onClick={() =>
                void search().catch((cause) =>
                  setError(cause instanceof Error ? cause.message : "Search failed."),
                )
              }
              className="rounded-xl border border-white/8 bg-white/[0.03] px-4 py-2.5 text-xs text-slate-300"
            >
              Search
            </button>
          </div>
          <div className="divide-y divide-white/6">
            {memories.length === 0 ? (
              <div className="p-5 text-sm text-slate-500">No matching memories.</div>
            ) : (
              memories.map((memory) => (
                <article key={memory.id} className="p-5">
                  <div className="flex gap-2">
                    <span className="rounded-full bg-violet-300/10 px-2 py-1 text-[10px] text-violet-200">
                      {memory.kind}
                    </span>
                    <span className="rounded-full bg-white/6 px-2 py-1 text-[10px] text-slate-400">
                      {memory.scope}
                    </span>
                  </div>
                  <p className="mt-3 text-sm leading-6 whitespace-pre-wrap text-slate-200">
                    {memory.text}
                  </p>
                  <div className="mt-3 text-[11px] text-slate-600">{memory.createdAt}</div>
                </article>
              ))
            )}
          </div>
        </section>
      </div>
    </section>
  );
}

function Banner({ children, tone }: { children: string; tone: "error" | "info" }) {
  return (
    <div
      className={
        "rounded-2xl border p-4 text-sm " +
        (tone === "error"
          ? "border-rose-300/15 bg-rose-300/5 text-rose-200"
          : "border-cyan-300/10 bg-cyan-300/5 text-cyan-100")
      }
    >
      {children}
    </div>
  );
}
