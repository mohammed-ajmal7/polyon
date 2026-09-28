import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { isAuthenticated } from "@/server/auth";

import { WorkspaceNav } from "./workspace-nav";

export default async function WorkspaceLayout({ children }: { children: ReactNode }) {
  if (!(await isAuthenticated())) redirect("/");

  return <WorkspaceNav>{children}</WorkspaceNav>;
}
