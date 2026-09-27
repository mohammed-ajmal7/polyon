"use client";

import { useMemo, useState } from "react";

type Mode = "Direct" | "Broadcast" | "Debate" | "Mission";
type ActivityKind = "SYSTEM" | "APPROVAL" | "EXECUTION" | "AGENT";

interface Activity {
  readonly id: number;
  readonly kind: ActivityKind;
  readonly title: string;
  readonly detail: string;
  readonly time: string;
}

const agents = [
  { name: "Research", role: "Evidence & synthesis", status: "ACTIVE", model: "Primary reasoning" },
  { name: "Builder", role: "Coding & implementation", status: "ACTIVE", model: "Coding runtime" },
  { name: "Critic", role: "Verification & challenge", status: "READY", model: "Independent reviewer" },
  { name: "Creative", role: "Image, video & audio", status: "READY", model: "Creative runtime" },
] as const;

const initialActivity: Activity[] = [
  {
    id: 1,
    kind: "SYSTEM",
    title: "POLYON initialized",
    detail: "Core domain, policy and runtime boundaries are online.",
    time: "Now",
  },
  {
    id: 2,
    kind: "EXECUTION",
    title: "Execution queue ready",
    detail: "2 governed work items are available.",
    time: "1m",
  },
  {
    id: 3,
    kind: "APPROVAL",
    title: "Approval lane idle",
    detail: "No consequential action is waiting for a decision.",
    time: "3m",
  },
];

const queue = [
  { title: "Connect agent runtime", kind: "CODING", state: "READY" },
  { title: "Design research pipeline", kind: "RESEARCH", state: "WAITING" },
  { title: "Validate policy scope", kind: "VALIDATION", state: "READY" },
] as const;

function statusClass(status: string) {
  if (status === "ACTIVE") return "bg-emerald-400/10 text-emerald-300 ring-1 ring-emerald-400/20";
  if (status === "READY") return "bg-sky-400/10 text-sky-300 ring-1 ring-sky-400/20";
  return "bg-amber-400/10 text-amber-300 ring-1 ring-amber-400/20";
}

function activityDot(kind: ActivityKind) {
  if (kind === "APPROVAL") return "bg-amber-300";
  if (kind === "EXECUTION") return "bg-cyan-300";
  if (kind === "AGENT") return "bg-violet-300";
  return "bg-slate-300";
}

export default function Home() {
  const [mode, setMode] = useState<Mode>("Mission");
  const [command, setCommand] = useState("");
  const [activities, setActivities] = useState(initialActivity);
  const [connectedAgent, setConnectedAgent] = useState("Research");

  const modeDescription = useMemo(() => {
    if (mode === "Direct") return "Work with one intelligence at a time.";
    if (mode === "Broadcast") return "Send one request to multiple agents independently.";
    if (mode === "Debate") return "Run a bounded proposal, criticism, evidence and adjudication flow.";
    return "Turn a larger objective into governed, executable work.";
  }, [mode]);

  function submitCommand() {
    const trimmed = command.trim();
    if (!trimmed) return;

    setActivities((current) => [
      {
        id: Date.now(),
        kind: "SYSTEM",
        title: "Command accepted",
        detail: trimmed,
        time: "Now",
      },
      ...current,
    ]);
    setCommand("");
  }

  return (
    <main className="min-h-screen bg-[#07090d] text-slate-100">
      <div className="mx-auto flex min-h-screen max-w-[1600px]">
        <aside className="hidden w-72 shrink-0 border-r border-white/8 bg-[#090c12] px-5 py-6 lg:flex lg:flex-col">
          <div className="flex items-center gap-3">
            <div className="grid size-10 place-items-center rounded-2xl border border-violet-300/15 bg-violet-300/8 text-sm font-semibold tracking-widest text-violet-200">
              P
            </div>
            <div>
              <div className="text-sm font-semibold tracking-[0.2em]">POLYON</div>
              <div className="text-xs text-slate-500">Personal AI Operations Network</div>
            </div>
          </div>

          <div className="mt-8 rounded-2xl border border-white/8 bg-white/[0.025] p-4">
            <div className="text-[11px] font-medium tracking-[0.18em] text-slate-500">
              OPERATING MODE
            </div>
            <div className="mt-3 flex items-center gap-2">
              <span className="size-2 rounded-full bg-emerald-300" />
              <span className="text-sm text-slate-200">Human controlled</span>
            </div>
            <p className="mt-2 text-xs leading-5 text-slate-500">
              Policy gates are evaluated before consequential execution.
            </p>
          </div>

          <nav className="mt-8 space-y-1.5">
            {["Command", "Missions", "Agents", "Evidence", "Artifacts", "Activity"].map(
              (item, index) => (
                <button
                  key={item}
                  type="button"
                  className={[
                    "flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left text-sm transition",
                    index === 0
                      ? "bg-white/7 text-white"
                      : "text-slate-400 hover:bg-white/[0.035] hover:text-slate-200",
                  ].join(" ")}
                >
                  <span>{item}</span>
                  {item === "Activity" ? (
                    <span className="rounded-full bg-white/7 px-2 py-0.5 text-[10px] text-slate-400">
                      {activities.length}
                    </span>
                  ) : null}
                </button>
              ),
            )}
          </nav>

          <div className="mt-auto border-t border-white/8 pt-4 text-xs text-slate-600">
            v0.1 architecture foundation
          </div>
        </aside>

        <section className="flex min-w-0 flex-1 flex-col">
          <header className="border-b border-white/8 bg-[#080b10]/90 px-5 py-4 backdrop-blur-xl sm:px-7">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <div className="text-xs font-medium tracking-[0.18em] text-violet-300/80">
                  AI OPERATIONS HQ
                </div>
                <h1 className="mt-1 text-xl font-semibold tracking-tight text-white sm:text-2xl">
                  One command. Many intelligences.
                </h1>
              </div>

              <div className="flex items-center gap-3">
                <div className="hidden rounded-xl border border-white/8 bg-white/[0.025] px-3 py-2 text-xs text-slate-400 md:block">
                  Private workspace · governed runtime
                </div>
                <div className="grid size-10 place-items-center rounded-xl border border-white/8 bg-white/[0.025] text-sm font-medium text-slate-300">
                  MA
                </div>
              </div>
            </div>
          </header>

          <div className="flex-1 overflow-y-auto px-5 py-6 sm:px-7 lg:px-8">
            <div className="grid gap-6 xl:grid-cols-[minmax(0,1.55fr)_minmax(340px,0.75fr)]">
              <div className="space-y-6">
                <section className="overflow-hidden rounded-3xl border border-white/10 bg-[#0d111a] shadow-2xl shadow-black/20">
                  <div className="border-b border-white/7 px-5 py-5 sm:px-6">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div>
                        <div className="text-xs font-medium tracking-[0.16em] text-slate-500">
                          COMMAND CENTER
                        </div>
                        <h2 className="mt-2 text-lg font-semibold text-white">
                          What should POLYON do?
                        </h2>
                        <p className="mt-1 max-w-2xl text-sm text-slate-400">
                          {modeDescription}
                        </p>
                      </div>
                      <div className="rounded-xl border border-emerald-300/10 bg-emerald-300/5 px-3 py-2 text-xs text-emerald-200">
                        {connectedAgent} selected
                      </div>
                    </div>

                    <div className="mt-5 flex flex-wrap gap-2">
                      {(["Direct", "Broadcast", "Debate", "Mission"] as Mode[]).map((entry) => (
                        <button
                          key={entry}
                          type="button"
                          aria-pressed={mode === entry}
                          onClick={() => setMode(entry)}
                          className={[
                            "rounded-xl px-3.5 py-2 text-xs font-medium transition",
                            mode === entry
                              ? "bg-violet-300/15 text-violet-100 ring-1 ring-violet-300/30"
                              : "bg-white/[0.03] text-slate-400 ring-1 ring-white/8 hover:bg-white/7 hover:text-slate-200",
                          ].join(" ")}
                        >
                          {entry}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="p-5 sm:p-6">
                    <textarea
                      value={command}
                      onChange={(event) => setCommand(event.target.value)}
                      onKeyDown={(event) => {
                        if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                          submitCommand();
                        }
                      }}
                      placeholder={
                        mode === "Mission"
                          ? "Describe the outcome you want. POLYON will turn it into governed work."
                          : "Give POLYON a command..."
                      }
                      className="min-h-36 w-full resize-none rounded-2xl border border-white/8 bg-black/20 p-4 text-sm leading-6 text-slate-100 outline-none transition placeholder:text-slate-600 focus:border-violet-300/25 focus:ring-4 focus:ring-violet-300/5"
                    />

                    <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                      <div className="text-xs text-slate-600">⌘↵ to run · approval gates remain enforced</div>
                      <button
                        type="button"
                        onClick={submitCommand}
                        className="rounded-xl bg-slate-100 px-4 py-2.5 text-xs font-semibold text-slate-900 transition hover:bg-white"
                      >
                        Run command
                      </button>
                    </div>
                  </div>
                </section>

                <section className="rounded-3xl border border-white/8 bg-[#0a0d13]">
                  <div className="flex items-center justify-between border-b border-white/7 px-5 py-4 sm:px-6">
                    <div>
                      <div className="text-xs font-medium tracking-[0.16em] text-slate-500">
                        ACTIVE MISSION
                      </div>
                      <h2 className="mt-1 text-base font-semibold text-white">
                        Build the POLYON execution spine
                      </h2>
                    </div>
                    <span className="rounded-full bg-cyan-300/8 px-2.5 py-1 text-[11px] text-cyan-200 ring-1 ring-cyan-300/15">
                      RUNNING
                    </span>
                  </div>

                  <div className="grid gap-4 p-5 sm:grid-cols-4 sm:p-6">
                    {[
                      ["Plan", "Approved"],
                      ["Tasks", "3 active"],
                      ["Approvals", "0 waiting"],
                      ["Queue", "2 ready"],
                    ].map(([label, value]) => (
                      <div key={label} className="rounded-2xl border border-white/7 bg-white/[0.02] p-4">
                        <div className="text-xs text-slate-600">{label}</div>
                        <div className="mt-2 text-sm font-medium text-slate-200">{value}</div>
                      </div>
                    ))}
                  </div>
                </section>

                <section className="rounded-3xl border border-white/8 bg-[#0a0d13]">
                  <div className="flex items-center justify-between border-b border-white/7 px-5 py-4 sm:px-6">
                    <div>
                      <div className="text-xs font-medium tracking-[0.16em] text-slate-500">
                        AGENT FLEET
                      </div>
                      <h2 className="mt-1 text-base font-semibold text-white">Logical agents</h2>
                    </div>
                    <span className="text-xs text-slate-600">4 registered</span>
                  </div>

                  <div className="grid gap-3 p-5 sm:grid-cols-2 sm:p-6">
                    {agents.map((agent) => (
                      <button
                        key={agent.name}
                        type="button"
                        onClick={() => setConnectedAgent(agent.name)}
                        className={[
                          "rounded-2xl border p-4 text-left transition",
                          connectedAgent === agent.name
                            ? "border-violet-300/20 bg-violet-300/[0.045]"
                            : "border-white/7 bg-white/[0.018] hover:bg-white/[0.03]",
                        ].join(" ")}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="text-sm font-medium text-slate-100">{agent.name}</div>
                            <div className="mt-1 text-xs text-slate-500">{agent.role}</div>
                          </div>
                          <span className={"rounded-full px-2 py-1 text-[10px] " + statusClass(agent.status)}>
                            {agent.status}
                          </span>
                        </div>
                        <div className="mt-4 border-t border-white/7 pt-3 text-xs text-slate-600">
                          {agent.model}
                        </div>
                      </button>
                    ))}
                  </div>
                </section>
              </div>

              <div className="space-y-6">
                <section className="rounded-3xl border border-white/8 bg-[#0a0d13]">
                  <div className="border-b border-white/7 px-5 py-4">
                    <div className="text-xs font-medium tracking-[0.16em] text-slate-500">
                      EXECUTION QUEUE
                    </div>
                    <div className="mt-1 flex items-center justify-between">
                      <h2 className="text-base font-semibold text-white">Governed work</h2>
                      <span className="text-xs text-slate-600">{queue.length} items</span>
                    </div>
                  </div>

                  <div className="divide-y divide-white/7">
                    {queue.map((item) => (
                      <div key={item.title} className="px-5 py-4">
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <div className="truncate text-sm text-slate-200">{item.title}</div>
                            <div className="mt-1 text-xs text-slate-600">{item.kind}</div>
                          </div>
                          <span className="rounded-full bg-white/[0.035] px-2 py-1 text-[10px] text-slate-500 ring-1 ring-white/7">
                            {item.state}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>

                <section className="rounded-3xl border border-white/8 bg-[#0a0d13]">
                  <div className="border-b border-white/7 px-5 py-4">
                    <div className="text-xs font-medium tracking-[0.16em] text-slate-500">
                      SYSTEM ACTIVITY
                    </div>
                    <div className="mt-1 flex items-center justify-between">
                      <h2 className="text-base font-semibold text-white">Live trace</h2>
                      <span className="text-xs text-slate-600">append-only view</span>
                    </div>
                  </div>

                  <div className="p-5">
                    <div className="space-y-5">
                      {activities.slice(0, 6).map((activity) => (
                        <div key={activity.id} className="flex gap-3">
                          <div className="mt-1.5 flex size-5 shrink-0 items-center justify-center">
                            <span className={"size-2 rounded-full " + activityDot(activity.kind)} />
                          </div>
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-sm font-medium text-slate-200">{activity.title}</span>
                              <span className="text-[11px] text-slate-600">{activity.time}</span>
                            </div>
                            <p className="mt-1 text-xs leading-5 text-slate-500">{activity.detail}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </section>

                <section className="rounded-3xl border border-amber-300/10 bg-amber-300/[0.025] p-5">
                  <div className="flex items-start gap-3">
                    <div className="grid size-9 shrink-0 place-items-center rounded-xl bg-amber-300/10 text-amber-200">
                      !
                    </div>
                    <div>
                      <div className="text-sm font-medium text-amber-100">Human authority</div>
                      <p className="mt-1 text-xs leading-5 text-amber-100/55">
                        POLYON can coordinate and execute work, but consequential actions remain
                        bounded by policy and approval controls.
                      </p>
                    </div>
                  </div>
                </section>
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
