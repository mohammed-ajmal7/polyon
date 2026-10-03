import Link from "next/link";
import { notFound } from "next/navigation";
import { isAuthenticated } from "@/server/auth";
import { getPersistentBackgroundRun } from "@/server/run-registry";
import { MarkdownText } from "@/components/markdown-text";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function HistoryDetail({ params }: { params: Promise<{ conversationId: string }> }) {
  if (!(await isAuthenticated())) return null;
  const { conversationId } = await params;
  const run = process.env.VERCEL === "1" ? await getPersistentBackgroundRun(conversationId) : undefined;
  if (run === undefined) notFound();
  const answer = extractAnswer(run.result);
  return (
    <section className="mx-auto max-w-5xl space-y-5">
      <Link href="/history" className="text-xs text-violet-200 hover:underline">← Chat history</Link>
      <article className="rounded-3xl border border-white/8 bg-[#0a0d13] p-6">
        <div className="flex flex-wrap gap-2 text-[10px] text-slate-500"><span>{run.mode}</span><span>·</span><span>{run.status}</span><span>·</span><span>{run.finishedAt ?? run.startedAt}</span></div>
        <h1 className="mt-4 text-xl font-semibold text-white">{run.command ?? "POLYON request"}</h1>
        {run.error ? <div className="mt-5 rounded-2xl bg-rose-300/5 p-4 text-sm text-rose-200">{run.error}</div> : null}
        {answer ? <div className="mt-6"><MarkdownText text={answer} /></div> : null}
      </article>
    </section>
  );
}
function extractAnswer(value: unknown): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    for (const key of ["answer", "summary", "text", "message", "content"]) if (typeof record[key] === "string") return record[key] as string;
  }
  return value === undefined ? "" : JSON.stringify(value, null, 2);
}
