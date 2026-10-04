"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type ReactNode } from "react";

interface RecentChat {
  readonly conversationId: string;
  readonly title: string;
  readonly messageCount: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

const CURRENT_CONVERSATION_STORAGE_KEY = "polyon.currentConversation";

function dayGroup(value: string): "Today" | "Yesterday" | "Last 7 days" | "Older" {
  const date = new Date(value);
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const time = date.getTime();
  const day = 86_400_000;
  if (time >= start) return "Today";
  if (time >= start - day) return "Yesterday";
  if (time >= start - day * 7) return "Last 7 days";
  return "Older";
}

function timeLabel(value: string): string {
  const date = new Date(value);
  const now = new Date();
  const sameYear = date.getFullYear() === now.getFullYear();
  return sameYear
    ? new Intl.DateTimeFormat("en-US", { hour: "2-digit", minute: "2-digit", hour12: false }).format(date)
    : new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(date);
}

export function WorkspaceNav({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [chats, setChats] = useState<readonly RecentChat[]>([]);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  async function refreshChats() {
    try {
      const response = await fetch("/api/conversations?limit=50", { cache: "no-store" });
      if (!response.ok) return;
      const body = (await response.json()) as { conversations?: RecentChat[] };
      setChats(body.conversations ?? []);
    } catch {
      // Conversation history remains optional UI state.
    }
  }

  useEffect(() => {
    try {
      setActiveChatId(window.localStorage.getItem(CURRENT_CONVERSATION_STORAGE_KEY));
    } catch {
      setActiveChatId(null);
    }
    void refreshChats();
    const onUpdate = () => {
      try { setActiveChatId(window.localStorage.getItem(CURRENT_CONVERSATION_STORAGE_KEY)); } catch { setActiveChatId(null); }
      void refreshChats();
    };
    window.addEventListener("polyon:chat-updated", onUpdate);
    const interval = window.setInterval(() => void refreshChats(), 15_000);
    return () => {
      window.removeEventListener("polyon:chat-updated", onUpdate);
      window.clearInterval(interval);
    };
  }, []);

  const grouped = useMemo(() => {
    const filtered = chats.filter((chat) => chat.title.toLowerCase().includes(search.trim().toLowerCase()));
    const groups: Record<string, RecentChat[]> = { Today: [], Yesterday: [], "Last 7 days": [], Older: [] };
    for (const chat of filtered) groups[dayGroup(chat.updatedAt)].push(chat);
    return groups;
  }, [chats, search]);

  function handleNewChat() {
    try { window.localStorage.removeItem(CURRENT_CONVERSATION_STORAGE_KEY); } catch {}
    setActiveChatId(null);
    if (pathname === "/") window.dispatchEvent(new Event("polyon:new-chat"));
    else router.push("/");
  }

  function handleOpenChat(id: string) {
    try { window.localStorage.setItem(CURRENT_CONVERSATION_STORAGE_KEY, id); } catch {}
    setActiveChatId(id);
    if (pathname === "/") {
      window.history.replaceState({}, "", "/?conversation=" + encodeURIComponent(id));
      window.dispatchEvent(new CustomEvent("polyon:open-chat", { detail: id }));
    } else {
      router.push("/?conversation=" + encodeURIComponent(id));
    }
  }

  return (
    <div className="min-h-screen bg-[#0a0c10] text-slate-100">
      <div className="flex min-h-screen">
        <aside className="hidden w-[350px] shrink-0 border-r border-white/[.055] bg-[#0d0f14] lg:flex lg:flex-col">
          <div className="flex h-[84px] items-center justify-between border-b border-white/[.055] px-8">
            <Link href="/" className="flex items-center gap-3">
              <div className="text-[25px] leading-none text-white">✦</div>
              <span className="text-[20px] font-semibold tracking-[.02em] text-slate-100">POLYON</span>
            </Link>
            <Link href="/approvals" title="Open approvals" className="grid size-8 place-items-center rounded-lg text-slate-500 hover:bg-white/[.05] hover:text-slate-200">
              <svg viewBox="0 0 24 24" className="size-[18px]" fill="none" stroke="currentColor" strokeWidth="1.7"><rect x="5" y="5" width="14" height="14" rx="3"/><path d="M9 9h6v6H9z"/></svg>
            </Link>
          </div>

          <div className="px-5 pt-6">
            <button type="button" onClick={handleNewChat} className="flex h-[53px] w-full items-center justify-center gap-2 rounded-[13px] bg-[#7478f2] text-[15px] font-medium text-white shadow-[0_7px_25px_rgba(116,120,242,.2)] transition hover:bg-[#7f83ff]">
              <span className="text-xl font-light">＋</span> New chat
            </button>

            <div className="relative mt-5">
              <svg viewBox="0 0 24 24" className="pointer-events-none absolute left-4 top-1/2 size-[18px] -translate-y-1/2 text-slate-500" fill="none" stroke="currentColor" strokeWidth="1.7"><circle cx="11" cy="11" r="6.5"/><path d="m16 16 4 4"/></svg>
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search conversations..." className="h-[45px] w-full rounded-[11px] border border-white/[.08] bg-[#11141a] pl-11 pr-14 text-[13px] text-slate-200 outline-none placeholder:text-slate-500 focus:border-white/[.15]" />
              <kbd className="absolute right-3 top-1/2 -translate-y-1/2 rounded-md border border-white/[.08] bg-white/[.025] px-2 py-1 font-mono text-[10px] text-slate-500">⌘ K</kbd>
            </div>
          </div>

          <div className="mt-8 min-h-0 flex-1 overflow-y-auto px-5 pb-5">
            {(["Today", "Yesterday", "Last 7 days", "Older"] as const).map((group) => {
              const entries = grouped[group];
              if (entries.length === 0) return null;
              return (
                <section key={group} className="mb-7">
                  <h2 className="mb-3 px-2 text-[13px] font-medium text-slate-500">{group}</h2>
                  <div className="space-y-1">
                    {entries.map((chat) => (
                      <button key={chat.conversationId} type="button" onClick={() => handleOpenChat(chat.conversationId)} title={chat.title} className={"flex w-full items-center gap-3 rounded-[10px] px-3 py-2.5 text-left transition " + (activeChatId === chat.conversationId ? "bg-[#232537] text-slate-100" : "text-slate-400 hover:bg-white/[.035] hover:text-slate-200")}>
                        <span className="grid size-6 shrink-0 place-items-center text-slate-300"><svg viewBox="0 0 24 24" className="size-[18px]" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M6 6.5h12a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H11l-4 3v-3H6a2 2 0 0 1-2-2v-6a2 2 0 0 1 2-2Z"/></svg></span>
                        <span className="min-w-0 flex-1 truncate text-[13px]">{chat.title}</span>
                        <span className="shrink-0 text-[11px] text-slate-500">{timeLabel(chat.updatedAt)}</span>
                      </button>
                    ))}
                  </div>
                </section>
              );
            })}
            {chats.length === 0 ? <p className="px-2 py-3 text-[12px] text-slate-600">Your conversations will appear here.</p> : null}
          </div>

          <div className="flex items-center justify-between border-t border-white/[.055] px-7 py-5">
            <div className="flex items-center gap-3">
              <div className="grid size-10 place-items-center rounded-full bg-[#252b3a] text-sm font-medium text-slate-200">U</div>
              <div><div className="text-[14px] text-slate-300">User</div><div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-slate-500"><span className="size-1.5 rounded-full bg-emerald-400" />Online</div></div>
            </div>
            <Link href="/settings" title="Settings" className="text-xl text-slate-500 hover:text-slate-200">⚙</Link>
          </div>
        </aside>

        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}
