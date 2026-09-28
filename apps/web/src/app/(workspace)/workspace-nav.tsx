"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

const items = [
  { href: "/", label: "Command" },
  { href: "/missions", label: "Missions" },
  { href: "/approvals", label: "Approvals" },
  { href: "/agents", label: "Agents" },
  { href: "/memory", label: "Memory" },
  { href: "/research", label: "Research" },
  { href: "/artifacts", label: "Artifacts" },
  { href: "/evidence", label: "Evidence" },
  { href: "/activity", label: "Activity" },
  { href: "/settings", label: "Settings" },
];

export function WorkspaceNav({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="min-h-screen bg-[#07090d] text-slate-100">
      <div className="mx-auto flex min-h-screen max-w-[1680px]">
        <aside className="hidden w-64 shrink-0 border-r border-white/8 bg-[#090c12] px-5 py-6 lg:flex lg:flex-col">
          <Link href="/" className="flex items-center gap-3">
            <div className="grid size-10 place-items-center rounded-2xl border border-violet-300/15 bg-violet-300/8 text-sm font-semibold tracking-widest text-violet-200">
              P
            </div>
            <div>
              <div className="text-sm font-semibold tracking-[0.2em]">POLYON</div>
              <div className="text-[11px] text-slate-500">Personal AI Operations Network</div>
            </div>
          </Link>

          <div className="mt-7 rounded-2xl border border-white/8 bg-white/[0.025] p-4">
            <div className="text-[10px] font-medium tracking-[0.18em] text-slate-500">
              OPERATING MODE
            </div>
            <div className="mt-3 flex items-center gap-2">
              <span className="size-2 rounded-full bg-emerald-300" />
              <span className="text-sm text-slate-200">Human controlled</span>
            </div>
            <p className="mt-2 text-xs leading-5 text-slate-500">
              Consequential actions remain behind policy and approval controls.
            </p>
          </div>

          <nav className="mt-7 space-y-1">
            {items.map((item) => {
              const active =
                item.href === "/"
                  ? pathname === "/"
                  : pathname === item.href || pathname.startsWith(item.href + "/");

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={
                    "flex items-center justify-between rounded-xl px-3 py-2.5 text-sm transition " +
                    (active
                      ? "bg-white/7 text-white ring-1 ring-white/8"
                      : "text-slate-400 hover:bg-white/[0.035] hover:text-slate-200")
                  }
                >
                  <span>{item.label}</span>
                  {item.label === "Approvals" ? (
                    <span className="rounded-full bg-amber-300/8 px-2 py-0.5 text-[10px] text-amber-200">
                      Gate
                    </span>
                  ) : null}
                </Link>
              );
            })}
          </nav>

          <div className="mt-auto border-t border-white/8 pt-4 text-[11px] leading-5 text-slate-600">
            v0.1 release-candidate workspace
          </div>
        </aside>

        <div className="min-w-0 flex-1">
          <header className="sticky top-0 z-10 border-b border-white/8 bg-[#080b10]/90 px-4 py-3 backdrop-blur-xl sm:px-6 lg:hidden">
            <div className="flex items-center gap-3">
              <Link
                href="/"
                className="grid size-9 place-items-center rounded-xl border border-violet-300/15 bg-violet-300/8 text-xs font-semibold text-violet-200"
              >
                P
              </Link>
              <div className="min-w-0 flex-1">
                <div className="text-xs font-semibold tracking-[0.18em]">POLYON</div>
                <div className="text-[10px] text-slate-500">AI Operations HQ</div>
              </div>
            </div>
            <nav className="mt-3 flex gap-1 overflow-x-auto pb-1">
              {items.map((item) => {
                const active =
                  item.href === "/"
                    ? pathname === "/"
                    : pathname === item.href || pathname.startsWith(item.href + "/");
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={
                      "shrink-0 rounded-lg px-2.5 py-1.5 text-[11px] " +
                      (active ? "bg-white/8 text-white" : "text-slate-500")
                    }
                  >
                    {item.label}
                  </Link>
                );
              })}
            </nav>
          </header>

          <main className="min-w-0 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">{children}</main>
        </div>
      </div>
    </div>
  );
}
