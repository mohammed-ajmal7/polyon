/// <reference types="node" />

import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { BoundedProcessAgentAdapter } from "./bounded-process-agent-adapter";

const roots: string[] = [];

describe("BoundedProcessAgentAdapter", () => {
  it("runs an explicitly allowed process without shell interpretation", async () => {
    const root = mkdtempSync(join(tmpdir(), "polyon-agent-"));
    roots.push(root);
    const script = join(root, "agent.cjs");
    writeFileSync(script, 'process.stdin.on("data", d => process.stdout.write(d));', "utf8");

    const adapter = new BoundedProcessAgentAdapter({
      rootDir: root,
      allowedExecutables: [process.execPath],
      environmentKeys: ["PATH"],
    });

    const result = await adapter.invoke({
      executable: process.execPath,
      args: [script],
      input: "hello",
      cwd: ".",
    });

    expect(result.stdout).toBe("hello");
    expect(result.exitCode).toBe(0);
  });

  it("rejects unallowlisted executables and escapes", async () => {
    const root = mkdtempSync(join(tmpdir(), "polyon-agent-"));
    roots.push(root);
    mkdirSync(join(root, "workspace"));
    const adapter = new BoundedProcessAgentAdapter({
      rootDir: root,
      allowedExecutables: [process.execPath],
    });

    await expect(
      adapter.invoke({
        executable: "not-allowed",
        input: "",
      }),
    ).rejects.toThrow("not allowlisted");

    await expect(
      adapter.invoke({
        executable: process.execPath,
        args: ["-e", "process.stdout.write('x')"],
        input: "",
        cwd: "../",
      }),
    ).rejects.toThrow("outside the configured root");
  });

  it("enforces output bounds", async () => {
    const root = mkdtempSync(join(tmpdir(), "polyon-agent-"));
    roots.push(root);
    const adapter = new BoundedProcessAgentAdapter({
      rootDir: root,
      allowedExecutables: [process.execPath],
      defaultMaxOutputBytes: 32,
    });

    await expect(
      adapter.invoke({
        executable: process.execPath,
        args: ["-e", "process.stdout.write('x'.repeat(100))"],
        input: "",
      }),
    ).rejects.toThrow("exceeds the 32-byte limit");
  });
});
