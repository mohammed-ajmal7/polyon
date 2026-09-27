import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import type { Policy } from "@polyon/contracts";
import { describe, expect, it } from "vitest";

import {
  BUILTIN_TOOL_IDS,
  createInMemoryBuiltinToolRegistries,
  registerBuiltinTools,
} from "@polyon/tools";
import { InMemoryDomainStores } from "@polyon/storage";
import { ToolInvocationService } from "./tool-invocation-service";

const policy: Policy = {
  id: "publish-policy",
  name: "Publish policy",
  description: "Requires human approval before publishing.",
  approvalMode: "BALANCED",
  rules: [],
  defaultEffect: "REQUIRE_APPROVAL",
  enabled: true,
  createdAt: "2026-09-27T01:00:00.000Z",
  updatedAt: "2026-09-27T01:00:00.000Z",
};

function createRepositories(): {
  readonly base: string;
  readonly worktree: string;
  readonly remote: string;
} {
  const base = mkdtempSync(join(tmpdir(), "polyon-publish-integration-"));
  const remote = join(base, "remote.git");
  const worktree = join(base, "work");

  execFileSync("git", ["init", "--bare", "-q", remote]);
  execFileSync("git", ["init", "-q", worktree]);
  execFileSync("git", ["-C", worktree, "config", "user.email", "polyon@example.invalid"]);
  execFileSync("git", ["-C", worktree, "config", "user.name", "POLYON Test"]);
  execFileSync("git", ["-C", worktree, "remote", "add", "origin", remote]);
  execFileSync("git", ["-C", worktree, "switch", "-c", "main"]);
  execFileSync("git", ["-C", worktree, "commit", "--allow-empty", "-q", "-m", "chore: initialize"]);

  return { base, worktree, remote };
}

describe("governed Git publish integration", () => {
  it("requires approval before publishing and pushes only after approval", async () => {
    const repositories = createRepositories();

    try {
      const registries = createInMemoryBuiltinToolRegistries();
      const stores = new InMemoryDomainStores();

      registerBuiltinTools(registries, {
        gitPublishRoot: repositories.worktree,
        gitPublishAllowedRemotes: ["origin"],
      });

      const service = new ToolInvocationService({
        tools: registries.tools,
        adapters: registries.adapters,
        approvals: stores.approvals,
        policyDecisions: stores.policyDecisions,
        events: stores.events,
        unitOfWork: stores,
      });

      const awaiting = await service.invoke({
        invocationId: "publish-invocation-1",
        toolId: BUILTIN_TOOL_IDS.gitPublish,
        input: {
          remote: "origin",
          branch: "main",
        },
        action: "PUBLISH",
        riskLevel: "HIGH",
        policy,
        decisionId: "publish-decision-1",
        approvalRequestId: "publish-approval-1",
        requestedBy: "agent-1",
        requestedAt: "2026-09-27T01:01:00.000Z",
        evaluatedAt: "2026-09-27T01:01:00.000Z",
        actorId: "agent-1",
        missionId: "mission-1",
        taskId: "task-1",
        executionId: "execution-1",
        agentId: "agent-1",
      });

      expect(awaiting.status).toBe("APPROVAL_REQUIRED");
      const refsBefore = execFileSync(
        "git",
        ["--git-dir", repositories.remote, "for-each-ref", "--format=%(refname)"],
        { encoding: "utf8" },
      );
      expect(refsBefore.trim()).toBe("");

      service.resolveApproval({
        approvalId: "publish-approval-1",
        status: "APPROVED",
        resolvedAt: "2026-09-27T01:02:00.000Z",
        resolvedBy: "user-1",
      });

      const result = await service.invokeApproved({
        invocationId: "publish-invocation-1",
        approvalId: "publish-approval-1",
        toolId: BUILTIN_TOOL_IDS.gitPublish,
        input: {
          remote: "origin",
          branch: "main",
        },
      });

      expect(result.status).toBe("SUCCEEDED");

      const remoteHead = execFileSync(
        "git",
        ["--git-dir", repositories.remote, "rev-parse", "refs/heads/main"],
        { encoding: "utf8" },
      ).trim();
      const localHead = execFileSync("git", ["-C", repositories.worktree, "rev-parse", "HEAD"], {
        encoding: "utf8",
      }).trim();

      expect(remoteHead).toBe(localHead);
      expect(stores.events.get("TOOL_INVOKED:publish-invocation-1:SUCCEEDED")?.data).toMatchObject({
        action: "PUBLISH",
        riskLevel: "HIGH",
      });
    } finally {
      rmSync(repositories.base, { recursive: true, force: true });
    }
  });
});
