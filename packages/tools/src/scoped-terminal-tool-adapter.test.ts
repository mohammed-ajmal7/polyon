/// <reference path="./node-runtime.d.ts" />

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  ScopedTerminalToolAdapter,
  ScopedTerminalToolError,
} from "./scoped-terminal-tool-adapter";

function createRoot(): string {
  return mkdtempSync(join(process.cwd(), ".tmp-polyon-terminal-"));
}

function cleanup(root: string): void {
  rmSync(root, { recursive: true, force: true });
}

const command =
  process.platform === "win32"
    ? { executable: process.execPath, args: ["-e"] }
    : { executable: process.execPath, args: ["-e"] };

describe("ScopedTerminalToolAdapter", () => {
  it("runs an allowlisted command without a shell", async () => {
    const root = createRoot();

    try {
      const adapter = new ScopedTerminalToolAdapter({
        toolId: "terminal.execute.scoped",
        rootDir: root,
        allowedCommands: [command.executable],
      });

      await expect(
        adapter.invoke({
          input: {
            command: command.executable,
            args: [...command.args, "process.stdout.write('hello')"],
          },
        }),
      ).resolves.toMatchObject({
        output: {
          command: command.executable,
          stdout: "hello",
          stderr: "",
          exitCode: 0,
          truncated: false,
        },
      });
    } finally {
      cleanup(root);
    }
  });

  it("rejects commands that are not explicitly allowlisted", async () => {
    const root = createRoot();

    try {
      const adapter = new ScopedTerminalToolAdapter({
        toolId: "terminal.execute.scoped",
        rootDir: root,
        allowedCommands: ["git"],
      });

      await expect(
        adapter.invoke({
          input: {
            command: command.executable,
          },
        }),
      ).rejects.toMatchObject({
        kind: "COMMAND_NOT_ALLOWED",
      });
    } finally {
      cleanup(root);
    }
  });

  it("keeps the working directory inside the configured root", async () => {
    const root = createRoot();
    const outside = createRoot();

    try {
      const adapter = new ScopedTerminalToolAdapter({
        toolId: "terminal.execute.scoped",
        rootDir: root,
        allowedCommands: [command.executable],
      });

      await expect(
        adapter.invoke({
          input: {
            command: command.executable,
            cwd: "../" + outside.split("/").pop(),
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

  it("times out long-running commands", async () => {
    const root = createRoot();

    try {
      const adapter = new ScopedTerminalToolAdapter({
        toolId: "terminal.execute.scoped",
        rootDir: root,
        allowedCommands: [command.executable],
        defaultTimeoutMs: 50,
        maxTimeoutMs: 100,
      });

      const script =
        process.platform === "win32"
          ? "setTimeout(() => {}, 500)"
          : "setTimeout(() => {}, 500)";

      await expect(
        adapter.invoke({
          input: {
            command: command.executable,
            args: [...command.args, script],
          },
        }),
      ).rejects.toMatchObject({
        kind: "TIMEOUT",
      });
    } finally {
      cleanup(root);
    }
  });

  it("bounds captured output", async () => {
    const root = createRoot();

    try {
      const adapter = new ScopedTerminalToolAdapter({
        toolId: "terminal.execute.scoped",
        rootDir: root,
        allowedCommands: [command.executable],
        defaultMaxOutputBytes: 15,
      });

      await expect(
        adapter.invoke({
          input: {
            command: command.executable,
            args: [...command.args, "process.stdout.write('0123456789abcdef')"],
          },
        }),
      ).rejects.toMatchObject({
        kind: "OUTPUT_TOO_LARGE",
      });
    } finally {
      cleanup(root);
    }
  });

  it("reports non-zero command exits", async () => {
    const root = createRoot();

    try {
      const adapter = new ScopedTerminalToolAdapter({
        toolId: "terminal.execute.scoped",
        rootDir: root,
        allowedCommands: [command.executable],
      });

      await expect(
        adapter.invoke({
          input: {
            command: command.executable,
            args: [
              ...command.args,
              "process.stderr.write('failed'); process.exit(7)",
            ],
          },
        }),
      ).rejects.toMatchObject({
        kind: "NON_ZERO_EXIT",
      });
    } finally {
      cleanup(root);
    }
  });

  it("rejects invalid roots at construction", () => {
    const root = createRoot();
    const file = join(root, "file.txt");
    writeFileSync(file, "file");

    expect(
      () =>
        new ScopedTerminalToolAdapter({
          toolId: "terminal.execute.scoped",
          rootDir: file,
          allowedCommands: [command.executable],
        }),
    ).toThrow(ScopedTerminalToolError);

    rmSync(root, { recursive: true, force: true });
  });

  it("rejects a non-directory working path", async () => {
    const root = createRoot();

    try {
      mkdirSync(join(root, "folder"));
      writeFileSync(join(root, "file.txt"), "file");
      const adapter = new ScopedTerminalToolAdapter({
        toolId: "terminal.execute.scoped",
        rootDir: root,
        allowedCommands: [command.executable],
      });

      await expect(
        adapter.invoke({
          input: {
            command: command.executable,
            cwd: "file.txt",
          },
        }),
      ).rejects.toMatchObject({
        kind: "NOT_A_DIRECTORY",
      });
    } finally {
      cleanup(root);
    }
  });
});
