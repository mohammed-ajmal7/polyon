"use client";

import Link from "next/link";
import { MarkdownText } from "@/components/markdown-text";
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";

import { agentLabel, toRunView, type RunView } from "@/lib/run-result";

type Depth = "Auto" | "Direct" | "Collaborative" | "DeepAnalysis";
type AdvancedMode = "Broadcast" | "Research" | "Debate" | "Mission";
type Mode = Depth | AdvancedMode;

const DEPTHS: readonly { readonly mode: Depth; readonly label: string; readonly hint: string }[] = [
  { mode: "Auto", label: "Auto", hint: "POLYON decides how much of the team to involve." },
  { mode: "Direct", label: "Quick", hint: "One agent answers right away." },
  { mode: "Collaborative", label: "Team", hint: "Several specialists answer, then one synthesis." },
  {
    mode: "DeepAnalysis",
    label: "Deep",
    hint: "Research, challenge, fact-check, debate and judge. Slow on local models.",
  },
];

const ADVANCED: readonly { readonly mode: AdvancedMode; readonly label: string }[] = [
  { mode: "Broadcast", label: "Ask several agents separately" },
  { mode: "Research", label: "Web research (needs a search endpoint)" },
  { mode: "Debate", label: "Structured debate" },
  { mode: "Mission", label: "Plan a multi-step mission" },
];

const MODE_NAMES: Record<string, string> = {
  Direct: "Quick answer",
  Broadcast: "Separate answers",
  Collaborative: "Team answer",
  Research: "Web research",
  DeepAnalysis: "Deep analysis",
  Debate: "Debate",
  Mission: "Mission",
};

interface StoredRun {
  readonly runId: string;
  readonly conversationId: string;
  readonly command: string;
  readonly startedAt: number;
}

interface ChatMessage {
  readonly id: string;
  readonly role: "user" | "assistant";
  readonly content: string;
  readonly createdAt: string;
  readonly mode?: string;
  readonly result?: unknown;
}

interface ChatConversation {
  readonly conversationId: string;
  readonly title: string;
  readonly messages: readonly ChatMessage[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

const RUN_STORAGE_KEY = "polyon.activeRun";
const CURRENT_CONVERSATION_STORAGE_KEY = "polyon.currentConversation";

function readStoredRun(): StoredRun | undefined {
  try {
    const raw = window.sessionStorage.getItem(RUN_STORAGE_KEY);
    if (raw === null) return undefined;
    const parsed = JSON.parse(raw) as Partial<StoredRun>;
    return typeof parsed.runId === "string" &&
      typeof parsed.conversationId === "string" &&
      typeof parsed.command === "string" &&
      typeof parsed.startedAt === "number"
      ? {
          runId: parsed.runId,
          conversationId: parsed.conversationId,
          command: parsed.command,
          startedAt: parsed.startedAt,
        }
      : undefined;
  } catch {
    return undefined;
  }
}

function storeRun(run: StoredRun | undefined): void {
  try {
    if (run === undefined) window.sessionStorage.removeItem(RUN_STORAGE_KEY);
    else window.sessionStorage.setItem(RUN_STORAGE_KEY, JSON.stringify(run));
  } catch {
    // Durable server state remains authoritative if browser storage is unavailable.
  }
}

function readCurrentConversationId(): string | undefined {
  try {
    const fromUrl = new URLSearchParams(window.location.search).get("conversation")?.trim();
    if (fromUrl !== undefined && fromUrl !== "") return fromUrl;
    const stored = window.localStorage.getItem(CURRENT_CONVERSATION_STORAGE_KEY)?.trim();
    return stored === undefined || stored === "" ? undefined : stored;
  } catch {
    return undefined;
  }
}

function storeCurrentConversationId(conversationId: string | undefined): void {
  try {
    if (conversationId === undefined) {
      window.localStorage.removeItem(CURRENT_CONVERSATION_STORAGE_KEY);
    } else {
      window.localStorage.setItem(CURRENT_CONVERSATION_STORAGE_KEY, conversationId);
    }
  } catch {
    // Server-side conversation storage is the source of truth.
  }
}

export default function HomePage() {
  const [command, setCommand] = useState("");
  const [mode, setMode] = useState<Mode>("Auto");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [pending, setPending] = useState(false);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [lastCommand, setLastCommand] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [approvalsWaiting, setApprovalsWaiting] = useState(0);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [chat, setChat] = useState<ChatConversation | null>(null);
  const conversationRef = useRef<string | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    let cancelled = false;
    async function loadApprovals() {
      try {
        const response = await fetch("/api/approvals", { cache: "no-store" });
        if (!response.ok) return;
        const body = (await response.json()) as { approvals?: unknown[] };
        if (!cancelled) setApprovalsWaiting(body.approvals?.length ?? 0);
      } catch {
        // The banner is advisory; the Approvals page is authoritative.
      }
    }
    void loadApprovals();
    const interval = window.setInterval(() => void loadApprovals(), 10_000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [chat?.updatedAt]);

  async function loadConversation(id: string): Promise<void> {
    try {
      const response = await fetch("/api/conversations/" + encodeURIComponent(id), {
        cache: "no-store",
      });
      if (!response.ok) {
        if (response.status === 404) {
          storeCurrentConversationId(undefined);
          setConversationId(null);
          setChat(null);
        }
        return;
      }
      const body = (await response.json()) as ChatConversation;
      setConversationId(body.conversationId);
      setChat(body);
      storeCurrentConversationId(body.conversationId);
      const latestAssistant = [...body.messages].reverse().find((message) => message.role === "assistant");
      const latestUser = [...body.messages].reverse().find((message) => message.role === "user");
      setLastCommand(latestUser?.content ?? null);

    } catch {
      setError("POLYON could not load this conversation.");
    }
  }

  function openChat(id: string): void {
    if (pending) return;
    storeCurrentConversationId(id);
    window.history.replaceState({}, "", "/?conversation=" + encodeURIComponent(id));
    void loadConversation(id);
  }

  function newChat(): void {
    if (pending) return;
    storeCurrentConversationId(undefined);
    window.history.replaceState({}, "", "/");
    setConversationId(null);
    setChat(null);
    setCommand("");
    setLastCommand(null);
    setError(null);
    setStartedAt(null);
    window.dispatchEvent(new Event("polyon:chat-updated"));
  }

  useEffect(() => {
    mountedRef.current = true;
    const storedRun = readStoredRun();
    const initialId = readCurrentConversationId();
    if (storedRun !== undefined) {
      storeCurrentConversationId(storedRun.conversationId);
      setConversationId(storedRun.conversationId);
      void loadConversation(storedRun.conversationId).finally(() => void followRun(storedRun));
    } else if (initialId !== undefined) {
      void loadConversation(initialId);
    }

    const handleOpen = (event: Event) => {
      const id = (event as CustomEvent<string>).detail;
      if (typeof id === "string" && id.trim() !== "") openChat(id);
    };
    const handleNew = () => newChat();
    window.addEventListener("polyon:open-chat", handleOpen);
    window.addEventListener("polyon:new-chat", handleNew);
    return () => {
      mountedRef.current = false;
      window.removeEventListener("polyon:open-chat", handleOpen);
      window.removeEventListener("polyon:new-chat", handleNew);
    };
  }, []);

  useEffect(() => {
    if (!pending) return;
    const tick = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(tick);
  }, [pending]);

  async function followRun(run: StoredRun) {
    conversationRef.current = run.runId;
    setPending(true);
    setStartedAt(run.startedAt);
    setNow(Date.now());
    setLastCommand(run.command);

    try {
      while (mountedRef.current) {
        await new Promise((resolve) => window.setTimeout(resolve, 2_500));
        const response = await fetch("/api/runs/" + encodeURIComponent(run.runId), {
          cache: "no-store",
        });
        if (response.status === 401) {
          window.location.assign("/login");
          return;
        }
        if (response.status === 404) {
          setError("POLYON could not find this execution. The chat itself remains saved.");
          break;
        }
        if (!response.ok) continue;

        const body = (await response.json()) as {
          status: "running" | "succeeded" | "failed";
          mode: string;
          modeReason?: string;
          result?: unknown;
          error?: string;
        };
        if (body.status === "running") {
          continue;
        }

        if (body.status === "failed") {
          setError(body.error ?? "POLYON could not run this request.");
        } else {
          await loadConversation(run.conversationId);
          window.dispatchEvent(new Event("polyon:chat-updated"));
        }
        break;
      }
    } catch {
      setError("POLYON stopped responding while working. Check that it is running.");
    } finally {
      if (mountedRef.current) {
        setPending(false);
        conversationRef.current = null;
        storeRun(undefined);
        setStartedAt(null);
      }
    }
  }

  async function submit(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    const trimmed = command.trim();
    if (pending || trimmed === "") return;

    const stableConversationId = conversationId ?? crypto.randomUUID();
    const optimisticMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: trimmed,
      createdAt: new Date().toISOString(),
    };

    const optimisticChat: ChatConversation = {
      conversationId: stableConversationId,
      title: chat?.title ?? trimmed.slice(0, 56),
      messages: [...(chat?.messages ?? []), optimisticMessage],
      createdAt: chat?.createdAt ?? optimisticMessage.createdAt,
      updatedAt: optimisticMessage.createdAt,
    };

    setConversationId(stableConversationId);
    setChat(optimisticChat);
    setLastCommand(trimmed);
    setError(null);
    setPending(true);
    setStartedAt(Date.now());
    setNow(Date.now());
    storeCurrentConversationId(stableConversationId);
    window.history.replaceState({}, "", "/");
    window.dispatchEvent(new Event("polyon:chat-updated"));

    try {
      const response = await fetch("/api/execute", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mode,
          command: trimmed,
          conversationId: stableConversationId,
          async: true,
          ...(mode === "DeepAnalysis" || mode === "Auto" ? { maxDebateRounds: 1 } : {}),
        }),
      });

      const body = (await response.json().catch(() => ({}))) as {
        error?: string;
        runId?: string;
        conversationId?: string;
        mode?: string;
        modeReason?: string;
        result?: unknown;
      };

      if (response.status === 401) {
        window.location.assign("/login");
        return;
      }

      if (!response.ok) {
        setError(body.error ?? "POLYON could not run this request.");
        return;
      }

      setCommand("");

      if (response.status === 201 && body.mode !== undefined && body.result !== undefined) {
        await loadConversation(stableConversationId);
        window.dispatchEvent(new Event("polyon:chat-updated"));
        return;
      }

      if (body.runId === undefined) {
        setError("POLYON accepted the message but did not return an execution id.");
        return;
      }

      const run: StoredRun = {
        runId: body.runId,
        conversationId: body.conversationId ?? stableConversationId,
        command: trimmed,
        startedAt: Date.now(),
      };
      storeRun(run);
      await followRun(run);
    } catch {
      setError("POLYON is not reachable. Check that it is running.");
    } finally {
      if (mountedRef.current && !conversationRef.current) {
        setPending(false);
        setStartedAt(null);
      }
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void submit();
    }
  }

  const elapsed = startedAt === null ? 0 : Math.max(0, Math.floor((now - startedAt) / 1000));
  const messages = chat?.messages ?? [];
  const selectedMode = DEPTHS.find((item) => item.mode === mode)?.label ?? MODE_NAMES[mode] ?? mode;

  async function shareConversation(): Promise<void> {
    const url = window.location.href;
    try {
      if (navigator.share) {
        await navigator.share({ title: chat?.title ?? "POLYON", url });
      } else {
        await navigator.clipboard.writeText(url);
        setError("Conversation link copied.");
        window.setTimeout(() => setError((current) => current === "Conversation link copied." ? null : current), 1800);
      }
    } catch {
      // User cancelled the native share sheet.
    }
  }

  const title = chat?.title ?? "New chat";
  const messageCount = messages.length;

  return (
    <div className="flex h-full min-h-[calc(100vh-64px)] flex-col overflow-hidden bg-[#0a0c10]">
      <header className="flex h-[84px] shrink-0 items-center border-b border-white/[.055] px-7 sm:px-8">
        <div className="min-w-0"><div className="flex items-center gap-2"><h1 className="truncate text-[17px] font-semibold tracking-[-.02em] text-slate-100">{title}</h1><span className="text-slate-600">⌄</span></div><p className="mt-1 text-[12px] text-slate-500">{messageCount} {messageCount === 1 ? "message" : "messages"}</p></div>
        <div className="ml-auto flex items-center gap-2">
          <button type="button" title="Share" onClick={() => void shareConversation()} className="grid size-9 place-items-center rounded-lg text-slate-400 hover:bg-white/[.05] hover:text-slate-200"><svg viewBox="0 0 24 24" className="size-[18px]" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M12 16V3"/><path d="m7 8 5-5 5 5"/><path d="M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6"/></svg></button>
          <button type="button" title="More" className="grid size-9 place-items-center rounded-lg text-slate-400 hover:bg-white/[.05] hover:text-slate-200"><span className="text-xl leading-none">⋮</span></button>
          <div className="mx-1 h-6 w-px bg-white/[.07]" />
          <Link href="/approvals" title="Approvals" className="grid size-9 place-items-center rounded-lg text-slate-400 hover:bg-white/[.05] hover:text-slate-200"><svg viewBox="0 0 24 24" className="size-[18px]" fill="none" stroke="currentColor" strokeWidth="1.6"><rect x="4" y="5" width="16" height="14" rx="2"/><path d="M8 8h8M8 12h5"/></svg></Link>
        </div>
      </header>
      <div className="relative flex min-h-0 flex-1 flex-col">
        <div className="flex-1 overflow-y-auto px-6 pb-44 pt-9 sm:px-10 lg:px-14">
          <div className="mx-auto w-full max-w-[1120px]">
            <div className="mb-8 flex items-center gap-5 text-[12px] text-slate-500"><div className="h-px flex-1 bg-white/[.06]" /><span>Today</span><div className="h-px flex-1 bg-white/[.06]" /></div>
            {messages.length === 0 ? (
              <div className="flex min-h-[48vh] items-center justify-center text-center"><div><div className="mx-auto grid size-12 place-items-center rounded-2xl border border-white/[.07] bg-white/[.025] text-2xl text-white">✦</div><h2 className="mt-5 text-2xl font-medium tracking-[-.03em] text-slate-200">What can I help you with?</h2><p className="mt-2 text-sm text-slate-500">Start a conversation with POLYON.</p></div></div>
            ) : (
              <section aria-label="Conversation messages" className="space-y-7">
                {messages.map((message) => {
                  const time = new Intl.DateTimeFormat("en-US", { hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(message.createdAt));
                  return message.role === "user" ? (
                    <div key={message.id} className="flex justify-end"><div className="max-w-[72%] rounded-[20px] bg-[#242438] px-5 py-3.5 text-[15px] leading-6 text-slate-100 shadow-sm"><div className="whitespace-pre-wrap break-words">{message.content}</div><div className="mt-1 flex items-center justify-end gap-1 text-[10px] text-slate-500"><span>{time}</span><span className="text-[#8f96ff]">✓✓</span></div></div></div>
                  ) : (
                    <article key={message.id} className="flex items-start gap-3"><div className="mt-1 grid size-9 shrink-0 place-items-center text-[25px] leading-none text-white">✦</div><div className="min-w-0 max-w-[70%]"><div className="rounded-[20px] rounded-tl-[7px] bg-[#171b22] px-5 py-4 text-[15px] leading-7 text-slate-200 shadow-[0_4px_24px_rgba(0,0,0,.12)]">
                          {message.result !== undefined && message.mode !== undefined ? (
                            <AnswerCard
                              view={toRunView(message.mode, { result: message.result })}
                              ranMode={{ mode: message.mode }}
                              command={null}
                            />
                          ) : (
                            <MarkdownText text={message.content} />
                          )}
                          <div className="mt-2 text-[10px] text-slate-500">{time}</div>
                        </div><div className="mt-2 flex items-center gap-4 pl-3 text-slate-500"><button type="button" title="Copy" className="hover:text-slate-200"><svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.7"><rect x="8" y="8" width="11" height="11" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg></button><button type="button" className="hover:text-slate-200">♡</button><button type="button" className="hover:text-slate-200">♧</button><button type="button" className="text-lg leading-none hover:text-slate-200">•••</button></div></div></article>
                  );
                })}
              </section>
            )}
            {approvalsWaiting > 0 ? <Link href="/approvals" className="mx-auto mt-7 flex max-w-[760px] items-center justify-between rounded-xl border border-amber-300/20 bg-amber-300/[.06] px-4 py-3 text-xs text-amber-100 hover:bg-amber-300/[.09]"><span>{approvalsWaiting === 1 ? "1 action is waiting for your approval." : approvalsWaiting + " actions are waiting for your approval."}</span><span>Review →</span></Link> : null}
            {error ? <p className="mx-auto mt-5 max-w-[760px] text-center text-xs text-rose-300">{error}</p> : null}
          </div>
        </div>
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-[#0a0c10] via-[#0a0c10]/95 to-transparent" />
        <div className="absolute inset-x-0 bottom-0 px-6 pb-5 pt-8 sm:px-10 lg:px-14">
          <form onSubmit={(event) => void submit(event)} className="mx-auto w-full max-w-[1120px]"><div className="rounded-[20px] border border-white/[.13] bg-[#11151b] shadow-[0_12px_45px_rgba(0,0,0,.35)]"><label htmlFor="command" className="sr-only">Message POLYON</label><textarea id="command" value={command} onChange={(event) => setCommand(event.target.value)} onKeyDown={onKeyDown} disabled={pending} rows={2} placeholder="Type a message..." className="min-h-[76px] w-full resize-none bg-transparent px-5 pt-4 text-[15px] leading-6 text-slate-100 outline-none placeholder:text-slate-500 disabled:opacity-60" /><div className="flex items-center gap-2 px-4 pb-3"><button type="button" disabled={pending} title="Add" className="grid size-9 place-items-center rounded-full bg-white/[.06] text-xl text-slate-300 hover:bg-white/[.1] disabled:opacity-50">+</button><div className="relative">
                  <button type="button" disabled={pending} aria-expanded={showAdvanced} onClick={() => setShowAdvanced((value) => !value)} className="flex items-center gap-2 rounded-full bg-white/[.055] px-3.5 py-2 text-xs font-medium text-slate-300 hover:bg-white/[.09] disabled:opacity-50">
                    <span className="text-[#a5a7ff]">◉</span> {selectedMode} <span className="text-slate-500">⌄</span>
                  </button>
                  {showAdvanced ? (
                    <div className="absolute bottom-[calc(100%+10px)] left-0 z-50 w-[290px] rounded-2xl border border-white/[.1] bg-[#141820] p-2 shadow-[0_18px_55px_rgba(0,0,0,.5)]">
                      <div className="px-3 py-2 text-[10px] font-semibold uppercase tracking-[.16em] text-slate-500">How POLYON should work</div>
                      {[...DEPTHS, ...ADVANCED.map((item) => ({ mode: item.mode, label: item.label, hint: "Advanced orchestration mode." }))].map((item) => (
                        <button key={item.mode} type="button" disabled={pending} onClick={() => { setMode(item.mode); setShowAdvanced(false); }} className={"flex w-full items-start rounded-xl px-3 py-2.5 text-left hover:bg-white/[.06] " + (mode === item.mode ? "bg-white/[.06] text-white" : "text-slate-300")}>
                          <span className="min-w-0"><span className="block text-xs font-medium">{item.label}</span><span className="mt-0.5 block text-[10px] leading-4 text-slate-500">{item.hint}</span></span>
                          {mode === item.mode ? <span className="ml-auto text-xs text-violet-300">✓</span> : null}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
                <button type="button" disabled={pending} title="Tools are selected automatically by the orchestration mode" onClick={() => { setShowAdvanced(true); }} className="flex items-center gap-2 rounded-full bg-white/[.055] px-3.5 py-2 text-xs font-medium text-slate-300 hover:bg-white/[.09] disabled:opacity-50">
                  <span>⌕</span> Tools <span className="text-slate-500">Auto</span>
                </button><button type="submit" disabled={pending || command.trim() === ""} className="ml-auto grid size-10 place-items-center rounded-full bg-[#7478f2] text-white shadow-[0_4px_18px_rgba(116,120,242,.25)] transition hover:bg-[#8185ff] disabled:cursor-not-allowed disabled:opacity-35"><svg viewBox="0 0 24 24" className="size-[18px]" fill="none" stroke="currentColor" strokeWidth="2"><path d="m5 12 14-7-3 14-4-6-7-1Z"/><path d="M12 13 19 5"/></svg></button></div></div>{pending ? <div className="mt-2 text-center text-[10px] text-slate-600">POLYON is working{elapsed > 0 ? " · " + formatElapsed(elapsed) : ""}…</div> : null}</form>
        </div>
      </div>
    </div>
  );
}

function AnswerCard({
  view,
  ranMode,
  command,
}: {
  view: RunView;
  ranMode: { mode: string; reason?: string } | null;
  command: string | null;
}) {
  const tone =
    view.outcome === "failed"
      ? "border-rose-300/20"
      : view.outcome === "needs-approval"
        ? "border-amber-300/25"
        : "border-white/10";

  return (
    <article className={"polyon-panel mt-5 rounded-3xl p-5 sm:p-7 " + tone}>
      <header>
        <div className="text-xs text-slate-400">
          {ranMode === null ? null : (MODE_NAMES[ranMode.mode] ?? ranMode.mode)}
          {ranMode?.reason === undefined ? null : <span> · {ranMode.reason}</span>}
        </div>
        {command === null ? null : <p className="mt-1 text-sm text-slate-400">“{command}”</p>}
        <h2 className="mt-3 text-lg font-semibold text-white">{view.headline}</h2>
      </header>

      {view.answer === undefined ? null : (
        <div className="mt-4"><MarkdownText text={view.answer} /></div>
      )}

      {view.approvalsWaiting > 0 ? (
        <Link
          href={view.missionId === undefined ? "/approvals" : "/missions/" + view.missionId}
          className="mt-4 inline-flex rounded-full bg-amber-300/15 px-4 py-2 text-sm text-amber-100 ring-1 ring-amber-300/30 hover:bg-amber-300/20 focus-visible:ring-2"
        >
          Review what POLYON wants to do →
        </Link>
      ) : null}

      {view.confirmed.length > 0 ? (
        <CheckList title="What is confirmed" checks={view.confirmed} />
      ) : null}
      {view.uncertain.length > 0 ? (
        <CheckList title="What is uncertain" checks={view.uncertain} />
      ) : null}

      {view.contributors.length > 0 ? (
        <div className="mt-5">
          <h3 className="text-xs font-medium text-slate-400">Worked on by</h3>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {uniqueBy(view.contributors, (contributor) => contributor.agentId).map(
              (contributor) => (
                <span
                  key={contributor.agentId}
                  className="rounded-full bg-white/5 px-2.5 py-1 text-xs text-slate-300"
                >
                  {contributor.role ?? agentLabel(contributor.agentId)}
                </span>
              ),
            )}
          </div>
        </div>
      ) : null}

      {view.problems.length > 0 ? (
        <details className="mt-5 rounded-2xl bg-white/[0.03] px-4 py-3 text-sm">
          <summary className="cursor-pointer text-slate-300">
            {view.problems.length === 1
              ? "1 part of the team ran into a problem"
              : `${view.problems.length} parts of the team ran into problems`}
          </summary>
          <ul className="mt-2 space-y-1 text-xs text-slate-400">
            {[...new Set(view.problems)].map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        </details>
      ) : null}

      <footer className="mt-5 flex flex-wrap gap-3 text-xs">
        {view.sourceCount > 0 ? (
          <Link href="/evidence" className="text-violet-200 hover:underline">
            View {view.sourceCount} {view.sourceCount === 1 ? "source" : "sources"}
          </Link>
        ) : null}
        {view.conversationId === undefined ? null : (
          <Link href="/activity" className="text-violet-200 hover:underline">
            View how the team worked
          </Link>
        )}
        {view.missionId === undefined ? null : (
          <Link href={"/missions/" + view.missionId} className="text-violet-200 hover:underline">
            Open mission
          </Link>
        )}
      </footer>
    </article>
  );
}

function CheckList({
  title,
  checks,
}: {
  title: string;
  checks: readonly { claim: string; verdict: string; rationale: string }[];
}) {
  return (
    <div className="mt-5">
      <h3 className="text-xs font-medium text-slate-400">{title}</h3>
      <ul className="mt-2 space-y-2">
        {uniqueBy(checks, (check) => check.claim).map((check) => (
          <li key={check.claim} className="rounded-2xl bg-white/[0.03] px-4 py-3 text-sm">
            <p className="line-clamp-3 text-slate-200">{check.claim}</p>
            {check.rationale === "" ? null : (
              <p className="mt-1 text-xs text-slate-400">{check.rationale}</p>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function collapseSteps(steps: readonly string[]): string[] {
  return [...new Set(steps)];
}

function formatElapsed(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  return minutes === 0 ? `${seconds}s` : `${minutes}m ${String(seconds % 60).padStart(2, "0")}s`;
}

function uniqueBy<T>(items: readonly T[], key: (item: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const value = key(item);
    if (seen.has(value)) return false;
    seen.add(value);
    return true;
  });
}
