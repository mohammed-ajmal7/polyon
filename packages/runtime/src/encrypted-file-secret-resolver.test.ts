/// <reference types="node" />

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

import { afterEach, describe, expect, it } from "vitest";

import type { SecretReference } from "@polyon/contracts";

import { EncryptedFileSecretResolver } from "./encrypted-file-secret-resolver";

const reference: SecretReference = {
  id: "email.primary",
  provider: "email",
  kind: "SMTP_CREDENTIAL",
};

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("EncryptedFileSecretResolver", () => {
  it("encrypts, resolves, replaces, and removes secrets", async () => {
    const directory = mkdtempSync(join(tmpdir(), "polyon-secret-test-"));
    directories.push(directory);
    const filePath = join(directory, "secrets.json");
    const key = randomBytes(32);
    const resolver = new EncryptedFileSecretResolver({ filePath, masterKey: key });

    resolver.set(reference, "super-secret");
    expect(await resolver.resolve(reference)).toBe("super-secret");

    const raw = readFileSync(filePath, "utf8");
    expect(raw).not.toContain("super-secret");
    expect(raw).not.toContain(key.toString("base64"));

    resolver.set(reference, "rotated-secret");
    expect(await resolver.resolve(reference)).toBe("rotated-secret");
    expect(resolver.has(reference)).toBe(true);
    expect(resolver.remove(reference)).toBe(true);
    expect(resolver.has(reference)).toBe(false);
    await expect(resolver.resolve(reference)).rejects.toThrow("not configured");
  });

  it("fails closed for wrong keys and metadata mismatches", async () => {
    const directory = mkdtempSync(join(tmpdir(), "polyon-secret-test-"));
    directories.push(directory);
    const filePath = join(directory, "secrets.json");

    const resolver = new EncryptedFileSecretResolver({
      filePath,
      masterKey: randomBytes(32),
    });
    resolver.set(reference, "secret");

    const reopened = new EncryptedFileSecretResolver({
      filePath,
      masterKey: randomBytes(32),
    });
    await expect(reopened.resolve(reference)).rejects.toThrow("not available");

    const mismatch = {
      ...reference,
      provider: "other",
    };
    await expect(resolver.resolve(mismatch)).rejects.toThrow("does not match");
  });

  it("rejects reference ids that the store could not load after a restart", () => {
    const directory = mkdtempSync(join(tmpdir(), "polyon-secret-test-"));
    directories.push(directory);
    const filePath = join(directory, "secrets.json");
    const masterKey = randomBytes(32);
    const resolver = new EncryptedFileSecretResolver({ filePath, masterKey });

    resolver.set(reference, "secret");
    expect(() => resolver.set({ ...reference, id: "email/primary" }, "secret")).toThrow(
      "Secret reference id must be",
    );
    expect(() => resolver.set({ ...reference, id: "x".repeat(201) }, "secret")).toThrow(
      "Secret reference id must be",
    );

    const reopened = new EncryptedFileSecretResolver({ filePath, masterKey });
    expect(reopened.has(reference)).toBe(true);
  });

  it("rejects invalid master keys", () => {
    expect(
      () =>
        new EncryptedFileSecretResolver({
          filePath: "/tmp/secrets.json",
          masterKey: new Uint8Array(31),
        }),
    ).toThrow("exactly 32 bytes");
  });
});
