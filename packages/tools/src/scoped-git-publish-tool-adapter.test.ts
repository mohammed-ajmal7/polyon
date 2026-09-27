import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, it } from "vitest";

import {
  ScopedGitPublishToolAdapter,
  ScopedGitPublishToolError,
} from "./scoped-git-publish-tool-adapter";

function cleanup(root: string): void {
  rmSync(root, { recursive: true, force: true });
}

function createRepositoryPair(): {
  readonly base: string;
  readonly root: string;
  readonly remote: string;
} {
  const base = mkdtempSync(join(tmpdir(), "polyon-git-publish-"));
  const remote = join(base, "remote.git");

  execFileSync("git", ["init", "--bare", "-q", remote]);

  const worktree = join(base, "work");
  execFileSync("git", ["init", "-q", worktree]);
  execFileSync("git", [
    "-C",
    worktree,
    "config",
    "user.email",
    "polyon@example.invalid",
  ]);
  execFileSync("git", [
    "-C",
    worktree,
    "config",
    "user.name",
    "POLYON Test",
  ]);
  execFileSync("git", [
    "-C",
    worktree,
    "remote",
    "add",
    "origin",
    remote,
  ]);

  execFileSync("git", ["-C", worktree, "switch", "-c", "main"]);
  execFileSync("git", ["-C", worktree, "commit", "--allow-empty", "-q", "-m", "chore: initialize"]);
  return { base, root: worktree, remote };
}

describe("ScopedGitPublishToolAdapter", () => {
  it("publishes HEAD to an explicitly allowlisted remote and branch", async () => {
    const pair = createRepositoryPair();

    try {
      const adapter = new ScopedGitPublishToolAdapter({
        toolId: "git.publish.scoped",
        rootDir: pair.root,
        allowedRemotes: ["origin"],
      });

      const result = await adapter.invoke({
        input: {
          remote: "origin",
          branch: "main",
        },
      });

      expect(result.output.commandOutput.exitCode).toBe(0);

      const remoteHead = execFileSync(
        "git",
        ["--git-dir", pair.remote, "rev-parse", "refs/heads/main"],
        { encoding: "utf8" },
      ).trim();
      const localHead = execFileSync(
        "git",
        ["-C", pair.root, "rev-parse", "HEAD"],
        { encoding: "utf8" },
      ).trim();

      expect(remoteHead).toBe(localHead);
    } finally {
      cleanup(pair.base);
    }
  });

  it("rejects a remote that is not explicitly allowlisted", async () => {
    const pair = createRepositoryPair();

    try {
      const adapter = new ScopedGitPublishToolAdapter({
        toolId: "git.publish.scoped",
        rootDir: pair.root,
        allowedRemotes: ["origin"],
      });

      await expect(
        adapter.invoke({
          input: {
            remote: "upstream",
            branch: "main",
          },
        }),
      ).rejects.toMatchObject({
        kind: "REMOTE_NOT_ALLOWED",
      });
    } finally {
      cleanup(pair.base);
    }
  });

  it("rejects unsafe branches without invoking Git", async () => {
    const pair = createRepositoryPair();

    try {
      const adapter = new ScopedGitPublishToolAdapter({
        toolId: "git.publish.scoped",
        rootDir: pair.root,
        allowedRemotes: ["origin"],
      });

      await expect(
        adapter.invoke({
          input: {
            remote: "origin",
            branch: "main;evil",
          },
        }),
      ).rejects.toMatchObject({
        kind: "INVALID_BRANCH",
      });
    } finally {
      cleanup(pair.base);
    }
  });

  it("requires an allowlist at construction", () => {
    const pair = createRepositoryPair();

    try {
      expect(
        () =>
          new ScopedGitPublishToolAdapter({
            toolId: "git.publish.scoped",
            rootDir: pair.root,
            allowedRemotes: [],
          }),
      ).toThrow(RangeError);
    } finally {
      cleanup(pair.base);
    }
  });

  it("rejects malformed input", async () => {
    const pair = createRepositoryPair();

    try {
      const adapter = new ScopedGitPublishToolAdapter({
        toolId: "git.publish.scoped",
        rootDir: pair.root,
        allowedRemotes: ["origin"],
      });

      await expect(
        adapter.invoke({
          input: {
            remote: "origin",
            branch: "",
          },
        }),
      ).rejects.toBeInstanceOf(ScopedGitPublishToolError);
    } finally {
      cleanup(pair.base);
    }
  });
});
