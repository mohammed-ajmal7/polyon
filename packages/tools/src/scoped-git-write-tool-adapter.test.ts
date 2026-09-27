import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { ScopedGitWriteToolAdapter } from "./scoped-git-write-tool-adapter";

function createRepository(): string {
  const root = mkdtempSync(join(tmpdir(), "polyon-git-write-"));
  execFileSync("git", ["init", "-q", root]);
  execFileSync("git", [
    "-C",
    root,
    "config",
    "user.email",
    "polyon@example.invalid",
  ]);
  execFileSync("git", ["-C", root, "config", "user.name", "POLYON Test"]);
  writeFileSync(join(root, "initial.txt"), "initial");
  execFileSync("git", ["-C", root, "add", "--", "initial.txt"]);
  execFileSync("git", [
    "-C",
    root,
    "commit",
    "-q",
    "-m",
    "chore: initialize test repository",
  ]);
  return root;
}

function cleanup(root: string): void {
  rmSync(root, { recursive: true, force: true });
}

describe("ScopedGitWriteToolAdapter", () => {
  it("creates a branch through a fixed Git operation", async () => {
    const root = createRepository();

    try {
      const adapter = new ScopedGitWriteToolAdapter({
        toolId: "git.write.scoped",
        rootDir: root,
      });

      await expect(
        adapter.invoke({
          input: {
            operation: "CREATE_BRANCH",
            branchName: "polyon/test-branch",
          },
        }),
      ).resolves.toMatchObject({
        output: {
          operation: "CREATE_BRANCH",
          commandOutput: {
            exitCode: 0,
          },
        },
      });

      const branches = execFileSync(
        "git",
        ["-C", root, "branch", "--list", "polyon/test-branch"],
        { encoding: "utf8" },
      );
      expect(branches).toContain("polyon/test-branch");
    } finally {
      cleanup(root);
    }
  });

  it("stages and unstages only explicit repository paths", async () => {
    const root = createRepository();

    try {
      writeFileSync(join(root, "notes.txt"), "hello");
      const adapter = new ScopedGitWriteToolAdapter({
        toolId: "git.write.scoped",
        rootDir: root,
      });

      await expect(
        adapter.invoke({
          input: {
            operation: "STAGE_PATHS",
            paths: ["notes.txt"],
          },
        }),
      ).resolves.toMatchObject({
        output: {
          operation: "STAGE_PATHS",
          commandOutput: {
            exitCode: 0,
          },
        },
      });

      const staged = execFileSync(
        "git",
        ["-C", root, "diff", "--cached", "--name-only"],
        { encoding: "utf8" },
      );
      expect(staged.trim()).toBe("notes.txt");

      await expect(
        adapter.invoke({
          input: {
            operation: "UNSTAGE_PATHS",
            paths: ["notes.txt"],
          },
        }),
      ).resolves.toMatchObject({
        output: {
          operation: "UNSTAGE_PATHS",
          commandOutput: {
            exitCode: 0,
          },
        },
      });

      const unstaged = execFileSync(
        "git",
        ["-C", root, "diff", "--cached", "--name-only"],
        { encoding: "utf8" },
      );
      expect(unstaged.trim()).toBe("");
    } finally {
      cleanup(root);
    }
  });

  it("rejects traversal outside the configured root", async () => {
    const root = createRepository();
    const outside = mkdtempSync(join(tmpdir(), "polyon-git-outside-"));

    try {
      writeFileSync(join(outside, "secret.txt"), "secret");
      const adapter = new ScopedGitWriteToolAdapter({
        toolId: "git.write.scoped",
        rootDir: root,
      });

      await expect(
        adapter.invoke({
          input: {
            operation: "STAGE_PATHS",
            paths: ["../" + outside.split("/").pop() + "/secret.txt"],
          },
        }),
      ).rejects.toMatchObject({
        kind: "OUTSIDE_ROOT",
      });
    } finally {
      cleanup(root);
      cleanup(outside);
    }
  });

  it("rejects unsafe branch names", async () => {
    const root = createRepository();

    try {
      const adapter = new ScopedGitWriteToolAdapter({
        toolId: "git.write.scoped",
        rootDir: root,
      });

      await expect(
        adapter.invoke({
          input: {
            operation: "CREATE_BRANCH",
            branchName: "unsafe name",
          },
        }),
      ).rejects.toMatchObject({
        kind: "INVALID_BRANCH",
      });
    } finally {
      cleanup(root);
    }
  });
});
