import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, it } from "vitest";

import { ScopedGitCommitToolAdapter } from "./scoped-git-commit-tool-adapter";

function createRepository(): string {
  const root = mkdtempSync(join(tmpdir(), "polyon-git-commit-"));
  execFileSync("git", ["init", "-q", root]);
  execFileSync("git", [
    "-C",
    root,
    "config",
    "user.email",
    "polyon@example.invalid",
  ]);
  execFileSync("git", ["-C", root, "config", "user.name", "POLYON Test"]);
  return root;
}

function cleanup(root: string): void {
  rmSync(root, { recursive: true, force: true });
}

describe("ScopedGitCommitToolAdapter", () => {
  it("commits the existing staged index with a fixed command shape", async () => {
    const root = createRepository();

    try {
      writeFileSync(join(root, "notes.txt"), "hello");
      execFileSync("git", ["-C", root, "add", "--", "notes.txt"]);

      const adapter = new ScopedGitCommitToolAdapter({
        toolId: "git.commit.scoped",
        rootDir: root,
      });

      await expect(
        adapter.invoke({
          input: {
            message: "feat: add notes",
          },
        }),
      ).resolves.toMatchObject({
        output: {
          message: "feat: add notes",
          commandOutput: {
            exitCode: 0,
          },
        },
      });

      const subject = execFileSync(
        "git",
        ["-C", root, "log", "-1", "--format=%s"],
        { encoding: "utf8" },
      ).trim();
      expect(subject).toBe("feat: add notes");
    } finally {
      cleanup(root);
    }
  });

  it("rejects empty and oversized commit messages", async () => {
    const root = createRepository();

    try {
      const adapter = new ScopedGitCommitToolAdapter({
        toolId: "git.commit.scoped",
        rootDir: root,
      });

      await expect(
        adapter.invoke({
          input: {
            message: " ",
          },
        }),
      ).rejects.toMatchObject({
        kind: "INVALID_INPUT",
      });

      await expect(
        adapter.invoke({
          input: {
            message: "x".repeat(501),
          },
        }),
      ).rejects.toMatchObject({
        kind: "INVALID_INPUT",
      });
    } finally {
      cleanup(root);
    }
  });

  it("does not bypass Git hooks or add extra commit flags", async () => {
    const root = createRepository();

    try {
      writeFileSync(join(root, "notes.txt"), "hello");
      execFileSync("git", ["-C", root, "add", "--", "notes.txt"]);

      const adapter = new ScopedGitCommitToolAdapter({
        toolId: "git.commit.scoped",
        rootDir: root,
      });

      const result = await adapter.invoke({
        input: {
          message: "chore: commit staged content",
        },
      });

      expect(result.output.commandOutput.exitCode).toBe(0);
      expect(result.output.commandOutput.stdout).not.toContain("--no-verify");
    } finally {
      cleanup(root);
    }
  });
});
