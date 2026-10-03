import Link from "next/link";

import {
  getDurableConversationHistory,
  getLocalConversationHistory,
  type ChatHistoryMessage,
} from "@/server/chat-history";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function labelFor(message: ChatHistoryMessage): string {
  if (message.role === "USER") return "You";
  if (message.role === "SYSTEM") return "POLYON";
  return message.fromAgentId ?? "POLYON";
}

export default async function ChatHistoryConversationPage({
  params,
}: {
  params: Promise<{ conversationId: string }>;
}) {
  const { conversationId } = await params;
  const id = decodeURIComponent(conversationId);

  const conversation =
    process.env.VERCEL === "1"
      ? await getDurableConversationHistory(id)
      : getLocalConversationHistory(id);

  if (conversation === undefined) {
    return (
      <section className="mx-auto max-w-4xl">
        <Link href="/history" className="text-sm text-violet-200 hover:underline">
          ← Chat History
        </Link>
        <div className="mt-6 rounded-3xl border border-rose-300/15 bg-rose-300/[.04] p-6">
          <h1 className="text-lg font-semibold text-white">Conversation not found</h1>
          <p className="mt-2 text-sm text-slate-400">
            This conversation is not available in durable chat history.
          </p>
        </div>
      </section>
    );
  }

  const firstUserMessage = conversation.messages.find((message) => message.role === "USER");

  return (
    <section className="mx-auto max-w-4xl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link href="/history" className="text-sm text-violet-200 hover:underline">
          ← Chat History
        </Link>
        <span className="text-[11px] text-slate-600">{formatDate(conversation.updatedAt)}</span>
      </div>

      <header className="mt-6 rounded-3xl border border-white/[.08] bg-[#0a0d13] p-5 sm:p-7">
        <div className="text-xs tracking-[0.16em] text-violet-300/70">{conversation.kind}</div>
        <h1 className="mt-2 text-xl font-semibold text-white">
          {firstUserMessage?.content ?? "Conversation"}
        </h1>
        <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-slate-500">
          <span>{conversation.messages.length} messages</span>
          <span>•</span>
          <span>{conversation.status}</span>
          <span>•</span>
          <span>{conversation.id}</span>
        </div>
      </header>

      <div className="mt-5 space-y-4">
        {conversation.messages.map((message) => (
          <article
            key={message.id}
            className={
              message.role === "USER"
                ? "ml-auto max-w-[88%] rounded-3xl border border-violet-300/15 bg-violet-300/[.08] p-4 sm:max-w-[78%]"
                : "mr-auto max-w-[92%] rounded-3xl border border-white/[.08] bg-[#0a0d13] p-4 sm:max-w-[82%]"
            }
          >
            <div className="flex items-center justify-between gap-3 text-[11px]">
              <span className={message.role === "USER" ? "font-medium text-violet-100" : "font-medium text-slate-300"}>
                {labelFor(message)}
              </span>
              <time className="text-slate-600" dateTime={message.createdAt}>
                {formatDate(message.createdAt)}
              </time>
            </div>
            <div className="mt-3 whitespace-pre-wrap break-words text-sm leading-7 text-slate-100">
              {message.content}
            </div>
          </article>
        ))}
      </div>

      <div className="mt-8">
        <Link
          href="/"
          className="inline-flex rounded-xl border border-white/[.09] bg-white/[.04] px-4 py-2.5 text-sm text-slate-200 hover:bg-white/[.07]"
        >
          Start a new conversation
        </Link>
      </div>
    </section>
  );
}
