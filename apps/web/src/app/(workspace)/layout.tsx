import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { isAuthenticated } from "@/server/auth";

import { WorkspaceNav } from "./workspace-nav";

// Workspace pages show live, authenticated state and must never be prerendered.
export const dynamic = "force-dynamic";

export default async function WorkspaceLayout({ children }: { children: ReactNode }) {
  if (!(await isAuthenticated())) redirect("/login");

  return <WorkspaceNav>{children}</WorkspaceNav>;
}
