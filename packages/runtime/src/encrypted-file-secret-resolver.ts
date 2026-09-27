/// <reference types="node" />

import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";

import type {
  SecretReference,
  SecretReferenceKind,
} from "@polyon/contracts";
import {
  SecretResolverError,
  type SecretResolver,
} from "@polyon/integrations";

const STORE_VERSION = 1;
const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const KEY_BYTES = 32;

interface StoredSecret {
  readonly provider: string;
  readonly kind: SecretReferenceKind;
  readonly iv: string;
  readonly ciphertext: string;
  readonly authTag: string;
}

interface SecretStoreFile {
  readonly version: 1;
  readonly secrets: Record<string, StoredSecret>;
}

export interface EncryptedFileSecretResolverOptions {
  readonly filePath: string;
  readonly masterKey: Uint8Array;
}

export class EncryptedFileSecretResolver implements SecretResolver {
  private readonly filePath: string;
  private readonly masterKey: Buffer;
  private secrets: Map<string, StoredSecret>;

  constructor(options: EncryptedFileSecretResolverOptions) {
    if (options.filePath.trim() === "") {
      throw new RangeError("Encrypted secret store filePath must not be empty.");
    }

    if (options.masterKey.byteLength !== KEY_BYTES) {
      throw new RangeError("Encrypted secret store masterKey must be exactly 32 bytes.");
    }

    this.filePath = options.filePath;
    this.masterKey = Buffer.from(options.masterKey);
    this.secrets = this.load();
  }

  async resolve(reference: SecretReference): Promise<string> {
    validateReference(reference);

    const stored = this.secrets.get(reference.id);
    if (stored === undefined) {
      throw new SecretResolverError(
        "REFERENCE_NOT_CONFIGURED",
        `Secret reference is not configured: ${reference.id}.`,
      );
    }

    if (stored.provider !== reference.provider || stored.kind !== reference.kind) {
      throw new SecretResolverError(
        "INVALID_REFERENCE",
        `Secret reference metadata does not match configured reference: ${reference.id}.`,
      );
    }

    try {
      const decipher = createDecipheriv(
        ALGORITHM,
        this.masterKey,
        Buffer.from(stored.iv, "base64"),
      );
      decipher.setAuthTag(Buffer.from(stored.authTag, "base64"));
      const plaintext = Buffer.concat([
        decipher.update(Buffer.from(stored.ciphertext, "base64")),
        decipher.final(),
      ]).toString("utf8");

      if (plaintext === "") {
        throw new Error("empty secret");
      }

      return plaintext;
    } catch {
      throw new SecretResolverError(
        "SECRET_NOT_AVAILABLE",
        `Secret value is not available for reference: ${reference.id}.`,
      );
    }
  }

  set(reference: SecretReference, value: string): void {
    validateReference(reference);

    if (value.length === 0) {
      throw new RangeError("Secret value must not be empty.");
    }

    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, this.masterKey, iv);
    const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
    const authTag = cipher.getAuthTag();

    const next = new Map(this.secrets);
    next.set(reference.id, {
      provider: reference.provider,
      kind: reference.kind,
      iv: iv.toString("base64"),
      ciphertext: ciphertext.toString("base64"),
      authTag: authTag.toString("base64"),
    });

    this.persist(next);
    this.secrets = next;
  }

  remove(reference: SecretReference): boolean {
    validateReference(reference);

    if (!this.secrets.has(reference.id)) {
      return false;
    }

    const next = new Map(this.secrets);
    next.delete(reference.id);
    this.persist(next);
    this.secrets = next;
    return true;
  }

  has(reference: SecretReference): boolean {
    validateReference(reference);
    const stored = this.secrets.get(reference.id);
    return stored !== undefined &&
      stored.provider === reference.provider &&
      stored.kind === reference.kind;
  }

  private load(): Map<string, StoredSecret> {
    if (!existsSync(this.filePath)) {
      return new Map();
    }

    try {
      const parsed = JSON.parse(readFileSync(this.filePath, "utf8")) as SecretStoreFile;
      if (parsed.version !== STORE_VERSION || parsed.secrets === null || typeof parsed.secrets !== "object") {
        throw new Error("unsupported secret store");
      }

      return new Map(
        Object.entries(parsed.secrets).map(([id, stored]) => {
          validateStoredSecret(id, stored);
          return [id, stored] as const;
        }),
      );
    } catch {
      throw new SecretResolverError(
        "SECRET_NOT_AVAILABLE",
        "Encrypted secret store could not be opened.",
      );
    }
  }

  private persist(secrets: ReadonlyMap<string, StoredSecret>): void {
    const state: SecretStoreFile = {
      version: STORE_VERSION,
      secrets: Object.fromEntries(secrets),
    };

    mkdirSync(dirname(this.filePath), { recursive: true });

    const tempPath = `${this.filePath}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`;
    writeFileSync(tempPath, JSON.stringify(state) + "\n", "utf8");
    chmodSync(tempPath, 0o600);

    try {
      renameSync(tempPath, this.filePath);
      chmodSync(this.filePath, 0o600);
    } catch (error) {
      try {
        unlinkSync(tempPath);
      } catch {
        // Preserve the original persistence error.
      }
      throw error;
    }
  }
}

function validateReference(reference: SecretReference): void {
  if (
    reference === undefined ||
    typeof reference.id !== "string" ||
    reference.id.trim() === "" ||
    typeof reference.provider !== "string" ||
    reference.provider.trim() === ""
  ) {
    throw new SecretResolverError(
      "INVALID_REFERENCE",
      "Secret reference must contain an id and provider.",
    );
  }
}

function validateStoredSecret(id: string, stored: StoredSecret): void {
  if (
    !/^[A-Za-z0-9._:-]{1,200}$/.test(id) ||
    stored === null ||
    typeof stored !== "object" ||
    typeof stored.provider !== "string" ||
    stored.provider.trim() === "" ||
    typeof stored.kind !== "string" ||
    typeof stored.iv !== "string" ||
    typeof stored.ciphertext !== "string" ||
    typeof stored.authTag !== "string"
  ) {
    throw new Error("invalid stored secret");
  }
}
