"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";

import { MarkdownContent } from "@/components/markdown-content";
import {
  getActiveChatId,
  getChat,
  normalizeAssistantText,
  readChats,
  setActiveChatId,
  titleFromCommand,
  upsertChat,
  type ChatMessage,
  type ChatRecord,
} from "@/lib/chat-store";
import { agentLabel, toRunView, type RunView } from "@/lib/run-result";

type Depth = "Auto" | "Direct" | "Collaborative" | "DeepAnalysis";
type AdvancedMode = "Broadcast" | "Research" | "Debate" | "Mission";
type Mode = Depth | AdvancedMode;

const DEPTHS: readonly { readonly mode: Depth; readonly label: string; readonly hint: string }[] = [
  { mode: "Auto", label: "Auto", hint: "POLYON decides how much of the team to involve." },
  { mode: "Direct", label: "Quick", hint: "One agent answers right away." },
  { mode: "Collaborative", label: "Team", hint: "Several specialists answer, then one synthesis." },
  { mode: "DeepAnalysis", label: "Deep", hint: "Research, challenge, fact-check, debate and judge." },
];

const ADVANCED: readonly { readonly mode: AdvancedMode; readonly label: string }[] = [
  { mode: "Broadcast", label: "Ask several agents separately" },
  { mode: "Research", label: "Web research" },
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

const STEP_LABELS: Record<string, string> = {
  COLLECTIVE_STARTED: "Team assembled",
  RESEARCH_STARTED: "Researching sources",
  RESEARCH_FINDING: "A finding came in",
  COLLECTIVE_CONTRIBUTION: "A specialist shared findings",
  COLLECTIVE_CHALLENGE: "Specialists are challenging each other",
  FACT_CHECK_STARTED: "Checking the important claims",
  FACT_CHECK_RESULT: "A claim was checked",
  DEBATE_CONTRIBUTION: "The team is debating",
  COLLECTIVE_SYNTHESIZED: "Writing the answer",
  RESEARCH_SYNTHESIZED: "Writing the answer",
  DEEP_ANALYSIS_COMPLETED: "Finishing up",
};

interface StoredRun {
  readonly runId: string;
  readonly chatId: string;
  readonly command: string;
  readonly startedAt: number;
}

const RUN_STORAGE_KEY = "polyon.activeRun.v2";

function readStoredRun(): StoredRun | undefined {
  try {
    const raw = window.sessionStorage.getItem(RUN_STORAGE_KEY);
    if (raw === null) return undefined;
    const parsed = JSON.parse(raw) as Partial<StoredRun>;
    return typeof parsed.runId === "string" &&
      typeof parsed.chatId === "string" &&
      typeof parsed.command === "string" &&
      typeof parsed.startedAt === "number"
      ? { runId: parsed.runId, chatId: parsed.chatId, command: parsed.command, startedAt: parsed.startedAt }
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
    // The run can continue without the resume hint.
  }
}

interface Progress {
  readonly steps: readonly string[];
  readonly messageCount: number;
}

export default function HomePage() {
  const [command, setCommand] = useState("");
  const [mode, setMode] = useState<Mode>("Auto");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [pending, setPending] = useState(false);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [progress, setProgress] = useState<Progress | null>(null);
  const [lastCommand, setLastCommand] = useState<string | null>(null);
  const [view, setView] = useState<RunView | null>(null);
  const [ranMode, setRanMode] = useState<{ mode: string; reason?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [approvalsWaiting, setApprovalsWaiting] = useState(0);
  const [chat, setChat] = useState<ChatRecord | null>(null);
  const [chatList, setChatList] = useState<ChatRecord[]>([]);
  const conversationRef = useRef<string | null>(null);
  const chatRef = useRef<ChatRecord | null>(null);
  const mountedRef = useRef(true);

  function saveChat(next: ChatRecord) {
    chatRef.current = next;
    setChat(next);
    upsertChat(next);
    setChatList(readChats());
  }

  function makeNewChat(): ChatRecord {
    const nowIso = new Date().toISOString();
    const next: ChatRecord = {
      id: crypto.randomUUID(),
      title: "New chat",
      createdAt: nowIso,
      updatedAt: nowIso,
      messages: [],
    };
    saveChat(next);
    setActiveChatId(next.id);
    setView(null);
    setRanMode(null);
    setError(null);
    setCommand("");
    return next;
  }

  function selectChat(id: string) {
    const next = getChat(id);
    if (next === undefined) return;
    setActiveChatId(id);
    chatRef.current = next;
    setChat(next);
    setView(null);
    setRanMode(null);
    setError(null);
    setCommand("");
  }

  function renameChat(title: string) {
    const current = chatRef.current;
    if (current === null) return;
    const clean = title.trim().slice(0, 80);
    if (clean === "" || clean === current.title) return;
    saveChat({ ...current, title: clean, updatedAt: new Date().toISOString() });
  }

  function appendMessage(message: ChatMessage) {
    const current = chatRef.current ?? makeNewChat();
    const next: ChatRecord = {
      ...current,
      messages: [...current.messages, message],
      title: current.messages.length === 0 && message.role === "user"
        ? titleFromCommand(message.content)
        : current.title,
      updatedAt: message.createdAt,
    };
    saveChat(next);
  }

  useEffect(() => {
    const chats = readChats();
    setChatList(chats);

    const activeId = getActiveChatId();
    const restored = (activeId === undefined ? undefined : getChat(activeId)) ?? chats[0];
    if (restored !== undefined) {
      chatRef.current = restored;
      setChat(restored);
      setActiveChatId(restored.id);
    } else {
      const created = {
        id: crypto.randomUUID(),
        title: "New chat",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        messages: [],
      };
      chatRef.current = created;
      setChat(created);
      upsertChat(created);
      setChatList([created]);
      setActiveChatId(created.id);
    }

    const stored = readStoredRun();
    if (stored !== undefined) void followRun(stored);

    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function loadApprovals() {
      try {
        const response = await fetch("/api/approvals", { cache: "no-store" });
        if (!response.ok) return;
        const body = (await response.json()) as { approvals?: unknown[] };
        if (!cancelled) setApprovalsWaiting(body.approvals?.length ?? 0);
      } catch {
        // Advisory only; the Approvals page is authoritative.
      }
    }
    void loadApprovals();
    const interval = window.setInterval(() => void loadApprovals(), 10_000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [view]);

  useEffect(() => {
    if (!pending) return;
    const tick = window.setInterval(() => setNow(Date.now()), 1_000);
    const poll = window.setInterval(() => {
      const conversationId = conversationRef.current;
      if (conversationId === null) return;
      void fetch("/api/conversations/" + encodeURIComponent(conversationId), { cache: "no-store" })
        .then((response) => (response.ok ? response.json() : undefined))
        .then((snapshot: { messages?: unknown[]; events?: { kind?: string }[] } | undefined) => {
          if (snapshot === undefined) return;
          const steps = (snapshot.events ?? [])
            .map((event) => STEP_LABELS[event.kind ?? ""])
            .filter((label): label is string => label !== undefined);
          setProgress({ steps, messageCount: snapshot.messages?.length ?? 0 });
        })
        .catch(() => undefined);
    }, 2_500);
    return () => {
      window.clearInterval(tick);
      window.clearInterval(poll);
    };
  }, [pending]);

  async function followRun(run: StoredRun) {
    conversationRef.current = run.runId;
    const restoredChat = getChat(run.chatId);
    if (restoredChat !== undefined) {
      chatRef.current = restoredChat;
      setChat(restoredChat);
    }
    setPending(true);
    setStartedAt(run.startedAt);
    setNow(Date.now());
    setLastCommand(run.command);

    try {
      while (mountedRef.current) {
        await new Promise((resolve) => window.setTimeout(resolve, 2_000));
        const response = await fetch("/api/runs/" + encodeURIComponent(run.runId), { cache: "no-store" });
        if (response.status === 401) {
          window.location.assign("/login");
          return;
        }
        if (response.status === 404) {
          setError("POLYON lost track of this request. Anything completed remains in the chat and Activity.");
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
        if (body.status === "running") continue;

        const nextView = body.status === "succeeded"
          ? toRunView(body.mode, { result: body.result })
          : null;

        setRanMode({
          mode: body.mode,
          ...(body.modeReason === undefined ? {} : { reason: body.modeReason }),
        });

        if (body.status === "failed") {
          const message = body.error ?? "POLYON could not complete this request.";
          setError(message);
          appendMessage({
            id: crypto.randomUUID(),
            role: "assistant",
            content: message,
            createdAt: new Date().toISOString(),
          });
        } else {
          setView(nextView);
          const answer = nextView?.answer?.trim();
          if (answer !== undefined && answer !== "") {
            appendMessage({
              id: crypto.randomUUID(),
              role: "assistant",
              content: normalizeAssistantText(answer),
              createdAt: new Date().toISOString(),
            });
          }
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
      }
    }
  }

  async function submit(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    const trimmed = command.trim();
    if (pending || trimmed === "") return;

    const currentChat = chatRef.current ?? makeNewChat();
    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: trimmed,
      createdAt: new Date().toISOString(),
    };
    const history = currentChat.messages.map((message) => ({
      role: message.role,
      content: message.content,
    }));
    appendMessage(userMessage);

    const run: StoredRun = {
      runId: crypto.randomUUID(),
      chatId: currentChat.id,
      command: trimmed,
      startedAt: Date.now(),
    };
    conversationRef.current = run.runId;
    setPending(true);
    setStartedAt(run.startedAt);
    setNow(Date.now());
    setProgress(null);
    setView(null);
    setRanMode(null);
    setError(null);
    setLastCommand(trimmed);

    try {
      const response = await fetch("/api/execute", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mode,
          command: trimmed,
          conversationId: run.runId,
          history: history.slice(-40),
          async: true,
          ...(mode === "DeepAnalysis" || mode === "Auto" ? { maxDebateRounds: 1 } : {}),
        }),
      });
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      if (response.status === 401) {
        window.location.assign("/login");
        return;
      }
      if (!response.ok) {
        setError(body.error ?? "POLYON could not run this request.");
        setPending(false);
        conversationRef.current = null;
        return;
      }
      setCommand("");
      storeRun(run);
      await followRun(run);
    } catch {
      setError("POLYON is not reachable. Check that it is running.");
      setPending(false);
      conversationRef.current = null;
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

  return (
    <div className="mx-auto flex max-w-[1050px] flex-col">
      {approvalsWaiting > 0 ? (
        <Link href="/approvals" className="mb-5 flex items-center justify-between rounded-2xl border border-amber-300/25 bg-amber-300/10 px-4 py-3 text-sm text-amber-100 transition hover:bg-amber-300/15">
          <span>{approvalsWaiting === 1 ? "1 action is waiting for your approval." : approvalsWaiting + " actions are waiting for your approval."}</span>
          <span>Review →</span>
        </Link>
      ) : null}

      <header className="mb-5 flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="mb-1 text-[10px] font-bold uppercase tracking-[.18em] text-violet-300/70">Conversation</div>
          <input
            aria-label="Chat name"
            value={chat?.title ?? "New chat"}
            onChange={(event) => {
              const current = chatRef.current;
              if (current === null) return;
              const next = { ...current, title: event.target.value, updatedAt: new Date().toISOString() };
              chatRef.current = next;
              setChat(next);
            }}
            onBlur={(event) => renameChat(event.target.value)}
            className="w-full bg-transparent text-xl font-semibold tracking-[-.02em] text-white outline-none placeholder:text-slate-600"
          />
        </div>
        <button type="button" onClick={() => makeNewChat()} className="shrink-0 rounded-xl border border-white/10 bg-white/[.035] px-3 py-2 text-xs font-medium text-slate-300 hover:bg-white/[.07]">
          + New chat
        </button>
      </header>

      <section className="min-h-[420px]">
        {messages.length === 0 ? (
          <div className="flex min-h-[390px] items-center justify-center px-6 text-center">
            <div className="max-w-xl">
              <div className="mx-auto mb-5 grid size-14 place-items-center rounded-2xl border border-violet-300/15 bg-violet-300/[.06] text-xl text-violet-200">P</div>
              <h1 className="text-3xl font-semibold tracking-[-.035em] text-white sm:text-4xl">What are we solving?</h1>
              <p className="mt-3 text-sm leading-6 text-slate-400">Ask a question or describe a task. Your AI team works on it, and consequential actions wait for your approval.</p>
            </div>
          </div>
        ) : (
          <div className="space-y-7 pb-5">
            {messages.map((message) => (
              <ChatBubble key={message.id} message={message} />
            ))}
            {pending ? (
              <div className="flex items-start gap-3">
                <div className="grid size-8 shrink-0 place-items-center rounded-xl border border-violet-300/15 bg-violet-300/[.06] text-xs font-bold text-violet-200">P</div>
                <div className="min-w-0 flex-1">
                  <div className="mb-2 text-[11px] font-semibold text-slate-500">POLYON</div>
                  <div className="rounded-2xl border border-white/[.07] bg-white/[.025] px-4 py-3 text-sm text-slate-300">
                    <span className="inline-flex items-center gap-2"><span className="size-1.5 animate-pulse rounded-full bg-violet-300" />Working{elapsed > 0 ? " · " + formatElapsed(elapsed) : ""}</span>
                  </div>
                  <div className="mt-2 text-xs text-slate-500">
                    {(progress?.steps.length ?? 0) === 0 ? "Getting the team started." : collapseSteps(progress?.steps ?? []).join(" · ")}
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        )}
      </section>

      {error !== null ? (
        <div className="mb-4 rounded-2xl border border-rose-300/15 bg-rose-400/[.07] px-4 py-3 text-sm text-rose-100">
          {error}
        </div>
      ) : null}

      {view !== null ? <RunMeta view={view} ranMode={ranMode} command={lastCommand} /> : null}

      <section className="sticky bottom-4 z-20 mt-3">
        <form onSubmit={(event) => void submit(event)} className="polyon-panel polyon-glow rounded-[24px] p-3">
          <label htmlFor="command" className="sr-only">Message POLYON</label>
          <textarea
            id="command"
            value={command}
            onChange={(event) => setCommand(event.target.value)}
            onKeyDown={onKeyDown}
            disabled={pending}
            rows={2}
            placeholder="Message POLYON…"
            className="max-h-48 min-h-[52px] w-full resize-none bg-transparent px-2 py-2 text-[16px] leading-7 text-slate-100 outline-none placeholder:text-slate-600 disabled:opacity-60"
          />
          <div className="flex flex-wrap items-center gap-2 border-t border-white/[.06] px-1 pt-3">
            <div role="radiogroup" aria-label="How much of the team to involve" className="flex flex-wrap gap-1">
              {DEPTHS.map((depth) => (
                <button key={depth.mode} type="button" role="radio" aria-checked={mode === depth.mode} title={depth.hint} disabled={pending} onClick={() => setMode(depth.mode)} className={"rounded-full px-3 py-1.5 text-xs transition " + (mode === depth.mode ? "bg-violet-300/20 text-violet-100 ring-1 ring-violet-300/40" : "text-slate-400 hover:bg-white/5 hover:text-slate-200")}>
                  {depth.label}
                </button>
              ))}
              <button type="button" aria-expanded={showAdvanced} disabled={pending} onClick={() => setShowAdvanced((value) => !value)} className="rounded-full px-3 py-1.5 text-xs text-slate-500 hover:bg-white/5 hover:text-slate-200">
                More…
              </button>
            </div>
            <button type="submit" disabled={pending || command.trim() === ""} className="ml-auto grid size-9 place-items-center rounded-xl bg-white text-sm font-bold text-slate-950 transition hover:bg-violet-50 disabled:cursor-not-allowed disabled:opacity-35" aria-label="Send">
              ↑
            </button>
          </div>
          {showAdvanced ? (
            <div className="mt-3 grid gap-1 border-t border-white/[.06] pt-3 sm:grid-cols-2">
              {ADVANCED.map((item) => (
                <button key={item.mode} type="button" disabled={pending} onClick={() => { setMode(item.mode); setShowAdvanced(false); }} className="rounded-xl px-3 py-2 text-left text-xs text-slate-300 hover:bg-white/5">
                  {item.label}
                </button>
              ))}
            </div>
          ) : null}
        </form>
        <p className="mt-2 px-2 text-[11px] text-slate-600">Enter to send · Shift+Enter for a new line · {DEPTHS.find((depth) => depth.mode === mode)?.hint}</p>
      </section>
    </div>
  );
}

function ChatBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user";
  return (
    <article className={isUser ? "flex justify-end" : "flex items-start gap-3"}>
      {isUser ? null : <div className="grid size-8 shrink-0 place-items-center rounded-xl border border-violet-300/15 bg-violet-300/[.06] text-xs font-bold text-violet-200">P</div>}
      <div className={isUser ? "max-w-[82%]" : "min-w-0 max-w-[900px] flex-1"}>
        <div className={"mb-1.5 text-[11px] font-semibold " + (isUser ? "text-right text-slate-600" : "text-slate-500")}>{isUser ? "You" : "POLYON"}</div>
        <div className={isUser ? "rounded-2xl rounded-br-md bg-white/[.08] px-4 py-3 text-[15px] leading-7 text-slate-100" : "text-[15px] leading-7 text-slate-200"}>
          {isUser ? <p className="whitespace-pre-wrap">{message.content}</p> : <MarkdownContent content={message.content} />}
        </div>
      </div>
    </article>
  );
}

function RunMeta({ view, ranMode, command }: { view: RunView; ranMode: { mode: string; reason?: string } | null; command: string | null }) {
  return (
    <div className="mb-4 rounded-2xl border border-white/[.06] bg-white/[.02] px-4 py-3 text-xs text-slate-500">
      <span className="font-medium text-slate-300">{ranMode === null ? "POLYON" : MODE_NAMES[ranMode.mode] ?? ranMode.mode}</span>
      {ranMode?.reason ? <span> · {ranMode.reason}</span> : null}
      {command ? <span className="hidden sm:inline"> · completed</span> : null}
      {view.approvalsWaiting > 0 ? (
        <Link href={view.missionId === undefined ? "/approvals" : "/missions/" + view.missionId} className="ml-3 text-amber-200 hover:underline">Review approval →</Link>
      ) : null}
      {view.contributors.length > 0 ? (
        <span className="ml-3">Worked on by {uniqueBy(view.contributors, (item) => item.agentId).map((item) => item.role ?? agentLabel(item.agentId)).join(", ")}</span>
      ) : null}
    </div>
  );
}

function collapseSteps(steps: readonly string[]): string[] {
  return [...new Set(steps)];
}

function formatElapsed(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  return minutes === 0 ? seconds + "s" : minutes + "m " + String(seconds % 60).padStart(2, "0") + "s";
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
