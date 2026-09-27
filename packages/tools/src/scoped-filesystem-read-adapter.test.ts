import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it } from "vitest";

import {
  FilesystemReadToolError,
  ScopedFilesystemReadToolAdapter,
} from "./scoped-filesystem-read-adapter";

const roots: string[] = [];

function createRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "polyon-tool-"));
  roots.push(root);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("ScopedFilesystemReadToolAdapter", () => {
  it("reads a regular file inside the configured root", async () => {
    const root = createRoot();
    writeFileSync(join(root, "hello.txt"), "hello");

    const adapter = new ScopedFilesystemReadToolAdapter({
      toolId: "filesystem-read",
      rootDir: root,
    });

    await expect(adapter.invoke({ input: { path: "hello.txt" } })).resolves.toEqual({
      output: {
        path: "hello.txt",
        content: "hello",
        sizeBytes: 5,
      },
    });
  });

  it("rejects traversal outside the configured root", async () => {
    const root = createRoot();
    const outside = createRoot();
    writeFileSync(join(outside, "secret.txt"), "secret");

    const adapter = new ScopedFilesystemReadToolAdapter({
      toolId: "filesystem-read",
      rootDir: root,
    });

    await expect(
      adapter.invoke({ input: { path: "../" + outside.split("/").pop() + "/secret.txt" } }),
    ).rejects.toMatchObject({
      kind: "OUTSIDE_ROOT",
    });
  });

  it("rejects a symlink that resolves outside the root", async () => {
    const root = createRoot();
    const outside = createRoot();
    writeFileSync(join(outside, "secret.txt"), "secret");
    symlinkSync(join(outside, "secret.txt"), join(root, "linked.txt"));

    const adapter = new ScopedFilesystemReadToolAdapter({
      toolId: "filesystem-read",
      rootDir: root,
    });

    await expect(
      adapter.invoke({ input: { path: "linked.txt" } }),
    ).rejects.toMatchObject({
      kind: "OUTSIDE_ROOT",
    });
  });

  it("rejects directories", async () => {
    const root = createRoot();
    mkdirSync(join(root, "folder"));

    const adapter = new ScopedFilesystemReadToolAdapter({
      toolId: "filesystem-read",
      rootDir: root,
    });

    await expect(
      adapter.invoke({ input: { path: "folder" } }),
    ).rejects.toMatchObject({
      kind: "NOT_A_FILE",
    });
  });

  it("rejects files larger than the configured byte limit", async () => {
    const root = createRoot();
    writeFileSync(join(root, "large.txt"), "123456");

    const adapter = new ScopedFilesystemReadToolAdapter({
      toolId: "filesystem-read",
      rootDir: root,
      defaultMaxBytes: 5,
    });

    await expect(
      adapter.invoke({ input: { path: "large.txt" } }),
    ).rejects.toMatchObject({
      kind: "FILE_TOO_LARGE",
    });
  });

  it("rejects malformed input and invalid limits", async () => {
    const root = createRoot();

    expect(
      () =>
        new ScopedFilesystemReadToolAdapter({
          toolId: "filesystem-read",
          rootDir: root,
          defaultMaxBytes: 0,
        }),
    ).toThrow(RangeError);

    const adapter = new ScopedFilesystemReadToolAdapter({
      toolId: "filesystem-read",
      rootDir: root,
    });

    await expect(adapter.invoke({ input: { path: "" } })).rejects.toMatchObject({
      kind: "INVALID_INPUT",
    });

    await expect(
      adapter.invoke({ input: { path: "missing.txt" } }),
    ).rejects.toMatchObject({
      kind: "NOT_FOUND",
    });

    const error = new FilesystemReadToolError(
      "INVALID_INPUT",
      "",
      "invalid",
    );
    expect(error.kind).toBe("INVALID_INPUT");
  });
});
