"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

interface ConversationSummary {
  id: string;
  kind: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  preview: string;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function titleFor(conversation: ConversationSummary): string {
  if (conversation.preview === "") return "Conversation " + conversation.id.slice(0, 8);
  return conversation.preview.length > 72
    ? conversation.preview.slice(0, 69) + "…"
    : conversation.preview;
}

export default function ChatHistoryPage() {
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/conversations", { cache: "no-store" })
      .then(async (response) => {
        if (response.status === 401) {
          window.location.assign("/login");
          return;
        }
        if (!response.ok) throw new Error("Chat history is temporarily unavailable.");
        const body = (await response.json()) as { conversations?: ConversationSummary[] };
        if (!cancelled) setConversations(body.conversations ?? []);
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : "Chat history is unavailable.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section className="mx-auto max-w-6xl space-y-6">
      <header>
        <div className="text-xs font-medium tracking-[0.18em] text-violet-300/75">CONVERSATIONS</div>
        <h1 className="mt-2 text-3xl font-semibold tracking-[-.03em] text-white">Chat History</h1>
        <p className="mt-2 text-sm leading-6 text-slate-400">
          Everything you have spoken to POLYON, kept as conversations you can open again.
        </p>
      </header>

      {loading ? (
        <div className="rounded-3xl border border-white/[.08] bg-[#0a0d13] p-8 text-sm text-slate-500">
          Loading your conversations…
        </div>
      ) : error !== null ? (
        <div role="alert" className="rounded-3xl border border-rose-300/15 bg-rose-300/[.04] p-8 text-sm text-rose-100">
          {error}
        </div>
      ) : conversations.length === 0 ? (
        <div className="rounded-3xl border border-white/[.08] bg-[#0a0d13] p-8">
          <h2 className="text-lg font-semibold text-white">No conversations yet</h2>
          <p className="mt-2 text-sm leading-6 text-slate-500">
            Your next request will appear here automatically.
          </p>
          <Link
            href="/"
            className="mt-5 inline-flex rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-slate-950 hover:bg-violet-50"
          >
            Start a conversation
          </Link>
        </div>
      ) : (
        <div className="overflow-hidden rounded-3xl border border-white/[.08] bg-[#0a0d13]">
          <div className="divide-y divide-white/[.06]">
            {conversations.map((conversation) => (
              <Link
                key={conversation.id}
                href={"/history/" + encodeURIComponent(conversation.id)}
                className="block px-5 py-5 transition hover:bg-white/[.035] focus-visible:bg-white/[.05] focus-visible:outline-none"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="truncate text-[15px] font-medium text-slate-100">
                      {titleFor(conversation)}
                    </h2>
                    <p className="mt-2 line-clamp-2 text-sm leading-6 text-slate-400">
                      {conversation.preview || "No user message recorded."}
                    </p>
                  </div>
                  <span className="shrink-0 text-[11px] text-slate-600">
                    {formatDate(conversation.updatedAt)}
                  </span>
                </div>
                <div className="mt-4 flex flex-wrap gap-2 text-[11px] text-slate-500">
                  <span className="rounded-full bg-white/[.04] px-2.5 py-1">{conversation.kind}</span>
                  <span className="rounded-full bg-white/[.04] px-2.5 py-1">
                    {conversation.messageCount} messages
                  </span>
                  <span className="rounded-full bg-white/[.04] px-2.5 py-1">{conversation.status}</span>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
