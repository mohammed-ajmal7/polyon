"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { ReactNode } from "react";

const items = [
  { href: "/", label: "Home" },
  { href: "/approvals", label: "Approvals" },
  { href: "/activity", label: "Activity" },
  { href: "/missions", label: "Missions" },
  { href: "/memory", label: "Memory" },
  { href: "/research", label: "Research" },
  { href: "/evidence", label: "Sources" },
  { href: "/artifacts", label: "Files" },
  { href: "/agents", label: "Team" },
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
              <div className="text-[11px] text-slate-400">Personal AI Operations Network</div>
            </div>
          </Link>

          <div className="mt-7 rounded-2xl border border-white/8 bg-white/[0.025] p-4">
            <div className="text-[11px] font-medium tracking-[0.18em] text-slate-400">
              OPERATING MODE
            </div>
            <div className="mt-3 flex items-center gap-2">
              <span className="size-2 rounded-full bg-emerald-300" />
              <span className="text-sm text-slate-200">Human controlled</span>
            </div>
            <p className="mt-2 text-xs leading-5 text-slate-400">
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
                  prefetch={false}
                  aria-current={active ? "page" : undefined}
                  className={
                    "flex items-center justify-between rounded-xl px-3 py-2.5 text-sm transition focus-visible:ring-2 focus-visible:ring-violet-300/60 " +
                    (active
                      ? "bg-white/7 text-white ring-1 ring-white/8"
                      : "text-slate-400 hover:bg-white/[0.035] hover:text-slate-200")
                  }
                >
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </nav>

          <div className="mt-auto flex items-center justify-between border-t border-white/8 pt-4 text-xs leading-5 text-slate-400">
            <span>POLYON v0.1</span>
            <SignOutButton />
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
                <div className="text-[11px] text-slate-400">Your private AI team</div>
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
                    prefetch={false}
                    className={
                      "shrink-0 rounded-lg px-3 py-2 text-xs " +
                      (active ? "bg-white/8 text-white" : "text-slate-400")
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

function SignOutButton() {
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={() => {
        void fetch("/api/auth", { method: "DELETE" }).finally(() => {
          router.replace("/login");
          router.refresh();
        });
      }}
      className="rounded-lg px-2 py-1 text-slate-300 hover:bg-white/5 focus-visible:ring-2 focus-visible:ring-violet-300/60"
    >
      Sign out
    </button>
  );
}
