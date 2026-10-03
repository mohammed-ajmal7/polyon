"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { ReactNode } from "react";

const items=[
 {href:"/",label:"Command",icon:"⌘",section:"Operate"},
 {href:"/missions",label:"Missions",icon:"◇",section:"Operate"},
 {href:"/approvals",label:"Approvals",icon:"✓",section:"Govern"},
 {href:"/executions",label:"Executions",icon:"▤",section:"Govern"},
 {href:"/agents",label:"AI Team",icon:"◉",section:"Intelligence"},
 {href:"/research",label:"Research",icon:"⌕",section:"Intelligence"},
 {href:"/memory",label:"Memory",icon:"▣",section:"Knowledge"},
 {href:"/evidence",label:"Evidence",icon:"◫",section:"Knowledge"},
 {href:"/artifacts",label:"Artifacts",icon:"□",section:"Knowledge"},
 {href:"/activity",label:"Activity",icon:"⌁",section:"Observe"},
 {href:"/settings",label:"Settings",icon:"⚙",section:"System"},
];

export function WorkspaceNav({children}:{children:ReactNode}){
 const pathname=usePathname();const router=useRouter();const groups=[...new Set(items.map(i=>i.section))];
 return <div className="min-h-screen bg-[#05070b] text-slate-100">
  <div className="pointer-events-none fixed inset-0 polyon-grid opacity-70"/>
  <div className="relative mx-auto flex min-h-screen max-w-[1800px]">
   <aside className="hidden w-[270px] shrink-0 border-r border-white/[.07] bg-[#070a10]/90 px-4 py-5 backdrop-blur-2xl lg:flex lg:flex-col">
    <Link href="/" className="flex items-center gap-3 px-2"><BrandMark/><div><div className="flex items-center gap-2"><span className="text-[15px] font-bold tracking-[.2em] text-white">POLYON</span><span className="rounded-full border border-violet-300/20 bg-violet-300/10 px-1.5 py-0.5 text-[8px] font-semibold text-violet-200">HQ</span></div><div className="mt-0.5 text-[10px] text-slate-500">Many intelligences. One command.</div></div></Link>
    <div className="mt-6 rounded-2xl border border-emerald-300/10 bg-emerald-300/[.035] p-3.5"><div className="flex items-center gap-2"><span className="polyon-dot size-2 rounded-full bg-emerald-300 text-emerald-300"/><span className="text-xs font-medium text-emerald-100">Human control active</span><span className="ml-auto text-[9px] font-semibold tracking-wider text-emerald-300/60">LIVE</span></div><p className="mt-2 text-[11px] leading-4 text-slate-500">Policy, approvals and execution gates protect consequential actions.</p></div>
    <nav className="mt-6 flex-1 overflow-y-auto pr-1">{groups.map(section=><div key={section} className="mb-5"><div className="polyon-kicker mb-2 px-2">{section}</div><div className="space-y-0.5">{items.filter(i=>i.section===section).map(item=>{const active=item.href==="/" ? pathname==="/" : pathname===item.href||pathname.startsWith(item.href+"/");return <Link key={item.href} href={item.href} prefetch={false} className={"group flex items-center gap-3 rounded-xl px-3 py-2.5 text-[13px] transition "+(active?"bg-white/[.075] text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,.07)]":"text-slate-500 hover:bg-white/[.035] hover:text-slate-200")}><span className={"grid size-6 place-items-center rounded-lg text-[13px] "+(active?"bg-violet-300/10 text-violet-200":"text-slate-600 group-hover:text-slate-300")}>{item.icon}</span><span className="flex-1">{item.label}</span>{item.href==="/approvals"?<span className="size-1.5 rounded-full bg-amber-300"/>:null}{active?<span className="h-4 w-px bg-violet-300/70"/>:null}</Link>})}</div></div>)}</nav>
    <div className="border-t border-white/[.07] pt-4"><div className="flex items-center justify-between px-2"><div><div className="text-[10px] font-medium text-slate-500">PERSONAL INSTANCE</div><div className="mt-1 font-mono text-[10px] text-slate-600">POLYON / 0.1 RC</div></div><button type="button" onClick={()=>{void fetch("/api/auth",{method:"DELETE"}).finally(()=>{router.replace("/login");router.refresh();});}} className="rounded-lg px-2 py-1.5 text-[11px] text-slate-500 hover:bg-white/5 hover:text-slate-200">Sign out</button></div></div>
   </aside>
   <div className="min-w-0 flex-1">
    <header className="sticky top-0 z-30 border-b border-white/[.07] bg-[#070a10]/80 backdrop-blur-2xl"><div className="flex h-16 items-center gap-3 px-4 sm:px-6 lg:px-9"><div className="lg:hidden"><BrandMark/></div><div className="hidden items-center gap-2 text-xs lg:flex"><span className="text-slate-500">Workspace</span><span className="text-slate-700">/</span><span className="font-medium text-slate-300">{currentLabel(pathname)}</span></div><div className="mx-auto hidden h-9 w-full max-w-md items-center gap-2 rounded-xl border border-white/[.08] bg-white/[.025] px-3 text-xs text-slate-500 sm:flex"><span>⌕</span><span className="flex-1">Jump to anything…</span><kbd className="rounded-md border border-white/10 px-1.5 py-0.5 font-mono text-[9px] text-slate-600">⌘ K</kbd></div><div className="ml-auto flex items-center gap-2"><div className="hidden items-center gap-2 rounded-full border border-white/[.07] bg-white/[.025] px-3 py-1.5 sm:flex"><span className="polyon-dot size-1.5 rounded-full bg-emerald-300 text-emerald-300"/><span className="text-[10px] font-medium text-slate-500">SYSTEM READY</span></div><Link href="/approvals" className="grid size-9 place-items-center rounded-xl border border-white/[.07] bg-white/[.025] text-slate-400 hover:border-amber-300/20 hover:text-amber-100">♢</Link></div></div><div className="flex gap-1 overflow-x-auto px-4 pb-2 lg:hidden">{items.slice(0,6).map(item=>{const active=item.href==="/" ? pathname==="/" : pathname===item.href||pathname.startsWith(item.href+"/");return <Link key={item.href} href={item.href} className={"shrink-0 rounded-lg px-3 py-1.5 text-[11px] "+(active?"bg-white/[.08] text-white":"text-slate-500")}>{item.label}</Link>})}</div></header>
    <main className="relative min-w-0 px-4 py-6 sm:px-6 lg:px-9 lg:py-8">{children}</main>
   </div>
  </div>
 </div>;
}
function currentLabel(pathname:string){const item=items.find(i=>i.href===pathname||(i.href!=="/"&&pathname.startsWith(i.href+"/")));return item?.label??"Command";}
function BrandMark(){return <div className="relative grid size-10 place-items-center overflow-hidden rounded-[13px] border border-violet-300/20 bg-gradient-to-br from-violet-400/20 via-violet-500/10 to-cyan-300/10 shadow-[0_0_35px_rgba(124,58,237,.15)]"><div className="absolute inset-2 rounded-lg border border-white/10"/><span className="relative text-sm font-black tracking-[.15em] text-white">P</span></div>;}
