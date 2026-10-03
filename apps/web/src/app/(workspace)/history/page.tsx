import Link from "next/link";
import { isAuthenticated } from "@/server/auth";
import { listPersistentBackgroundRuns } from "@/server/run-registry";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function HistoryPage() {
  if (!(await isAuthenticated())) return null;
  let conversations: Awaited<ReturnType<typeof listPersistentBackgroundRuns>> = [];
  let error = "";
  try {
    conversations = process.env.VERCEL === "1" ? await listPersistentBackgroundRuns(100) : [];
  } catch (cause) {
    error = cause instanceof Error ? cause.message : "History is unavailable.";
  }
  return (
    <section className="mx-auto max-w-5xl space-y-6">
      <header>
        <div className="text-xs font-medium tracking-[0.18em] text-cyan-300/75">HISTORY</div>
        <h1 className="mt-2 text-2xl font-semibold text-white">Chat history</h1>
        <p className="mt-2 text-sm leading-6 text-slate-400">Durable POLYON conversations that survive browser reloads and Vercel instance changes.</p>
      </header>
      {error ? <div className="rounded-2xl border border-rose-300/15 bg-rose-300/5 p-4 text-sm text-rose-200">{error}</div> : null}
      {conversations.length === 0 ? <div className="rounded-3xl border border-white/8 bg-[#0a0d13] p-6 text-sm text-slate-500">No durable conversations yet.</div> : (
        <div className="space-y-3">{conversations.map((run) => (
          <Link key={run.runId} href={"/history/" + encodeURIComponent(run.runId)} className="block rounded-3xl border border-white/8 bg-[#0a0d13] p-5 transition hover:border-violet-300/20 hover:bg-white/[0.025]">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-violet-300/10 px-2.5 py-1 text-[10px] text-violet-200">{run.mode}</span>
              <span className="rounded-full bg-white/5 px-2.5 py-1 text-[10px] text-slate-400">{run.status}</span>
              <span className="ml-auto text-[11px] text-slate-600">{run.finishedAt ?? run.startedAt}</span>
            </div>
            <p className="mt-3 line-clamp-2 text-sm leading-6 text-slate-200">{run.command ?? "POLYON request"}</p>
          </Link>
        ))}</div>
      )}
    </section>
  );
}
