import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { ScopedGitReadToolAdapter, ScopedGitReadToolError } from "./scoped-git-read-tool-adapter";

function createRepository(): string {
  const root = mkdtempSync(join(tmpdir(), "polyon-git-read-"));
  execFileSync("git", ["init", "-q", root]);
  execFileSync("git", ["-C", root, "config", "user.email", "polyon@example.invalid"]);
  execFileSync("git", ["-C", root, "config", "user.name", "POLYON Test"]);
  return root;
}

function cleanup(root: string): void {
  rmSync(root, { recursive: true, force: true });
}

describe("ScopedGitReadToolAdapter", () => {
  it("reads repository status through a fixed operation", async () => {
    const root = createRepository();

    try {
      const adapter = new ScopedGitReadToolAdapter({
        toolId: "git.read.scoped",
        rootDir: root,
      });

      await expect(
        adapter.invoke({
          input: {
            operation: "STATUS",
          },
        }),
      ).resolves.toMatchObject({
        output: {
          operation: "STATUS",
          commandOutput: {
            exitCode: 0,
            stdout: expect.stringContaining("## No commits yet on"),
          },
        },
      });
    } finally {
      cleanup(root);
    }
  });

  it("supports bounded read operations without exposing arbitrary arguments", async () => {
    const root = createRepository();

    try {
      const adapter = new ScopedGitReadToolAdapter({
        toolId: "git.read.scoped",
        rootDir: root,
      });

      await expect(
        adapter.invoke({
          input: {
            operation: "DIFF",
          },
        }),
      ).resolves.toMatchObject({
        output: {
          operation: "DIFF",
          commandOutput: {
            exitCode: 0,
          },
        },
      });

      await expect(
        adapter.invoke({
          input: {
            operation: "STATUS",
            timeoutMs: 20_000,
            maxOutputBytes: 8_192,
          },
        }),
      ).resolves.toMatchObject({
        output: {
          operation: "STATUS",
        },
      });
    } finally {
      cleanup(root);
    }
  });

  it("limits read operations to a scoped subdirectory of the repository", async () => {
    const root = createRepository();

    try {
      mkdirSync(join(root, "scoped"));
      writeFileSync(join(root, "scoped", "inside.txt"), "inside\n");
      writeFileSync(join(root, "outside.txt"), "outside\n");
      execFileSync("git", ["-C", root, "add", "--", "."]);
      execFileSync("git", ["-C", root, "commit", "-q", "-m", "chore: add both files"]);
      writeFileSync(join(root, "outside.txt"), "outside changed\n");
      execFileSync("git", ["-C", root, "commit", "-q", "-a", "-m", "chore: change outside file"]);
      writeFileSync(join(root, "scoped", "inside.txt"), "inside changed\n");
      writeFileSync(join(root, "outside.txt"), "outside changed again\n");
      writeFileSync(join(root, "untracked-outside.txt"), "untracked\n");

      const adapter = new ScopedGitReadToolAdapter({
        toolId: "git.read.scoped",
        rootDir: join(root, "scoped"),
      });
      const read = async (operation: "STATUS" | "DIFF" | "LOG" | "SHOW") =>
        (await adapter.invoke({ input: { operation } })).output.commandOutput.stdout;

      const status = await read("STATUS");
      expect(status).toContain("inside.txt");
      expect(status).not.toContain("outside");

      const diff = await read("DIFF");
      expect(diff).toContain("inside changed");
      expect(diff).not.toContain("outside");

      const log = await read("LOG");
      expect(log).toContain("chore: add both files");
      expect(log).not.toContain("chore: change outside file");

      expect(await read("SHOW")).not.toContain("outside.txt");
    } finally {
      cleanup(root);
    }
  });

  it("rejects unsupported operations", async () => {
    const root = createRepository();

    try {
      const adapter = new ScopedGitReadToolAdapter({
        toolId: "git.read.scoped",
        rootDir: root,
      });

      await expect(
        adapter.invoke({
          input: {
            operation: "COMMIT" as never,
          },
        }),
      ).rejects.toMatchObject({
        kind: "INVALID_INPUT",
      });
    } finally {
      cleanup(root);
    }
  });

  it("maps command failures to a fail-closed error", async () => {
    const root = mkdtempSync(join(tmpdir(), "polyon-git-not-repo-"));

    try {
      const adapter = new ScopedGitReadToolAdapter({
        toolId: "git.read.scoped",
        rootDir: root,
      });

      await expect(
        adapter.invoke({
          input: {
            operation: "LOG",
          },
        }),
      ).rejects.toMatchObject({
        kind: "COMMAND_FAILED",
      });
    } finally {
      cleanup(root);
    }
  });

  it("requires a valid root directory", () => {
    const root = mkdtempSync(join(tmpdir(), "polyon-git-root-"));

    try {
      expect(
        () =>
          new ScopedGitReadToolAdapter({
            toolId: "git.read.scoped",
            rootDir: join(root, "missing"),
          }),
      ).toThrow(ScopedGitReadToolError);
    } finally {
      cleanup(root);
    }
  });
});
