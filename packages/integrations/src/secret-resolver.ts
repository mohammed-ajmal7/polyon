import type { SecretReference, SecretReferenceKind } from "@polyon/contracts";

export interface SecretResolver {
  resolve(reference: SecretReference): Promise<string>;
}

export type SecretResolverErrorKind =
  "INVALID_REFERENCE" | "REFERENCE_NOT_CONFIGURED" | "SECRET_NOT_AVAILABLE";

export class SecretResolverError extends Error {
  readonly kind: SecretResolverErrorKind;

  constructor(kind: SecretResolverErrorKind, message: string) {
    super(message);
    this.name = "SecretResolverError";
    this.kind = kind;
  }
}

export interface EnvironmentSecretResolverOptions {
  readonly environment: Readonly<Record<string, string | undefined>>;
  readonly references: Readonly<
    Record<
      string,
      {
        readonly provider: string;
        readonly kind: SecretReferenceKind;
        readonly environmentVariable: string;
      }
    >
  >;
}

export class EnvironmentSecretResolver implements SecretResolver {
  private readonly environment: Readonly<Record<string, string | undefined>>;
  private readonly references: ReadonlyMap<
    string,
    {
      readonly provider: string;
      readonly kind: SecretReferenceKind;
      readonly environmentVariable: string;
    }
  >;

  constructor(options: EnvironmentSecretResolverOptions) {
    this.environment = options.environment;
    this.references = new Map(Object.entries(options.references));

    for (const [referenceId, mapping] of this.references) {
      if (!isSafeReferenceId(referenceId)) {
        throw new RangeError(`Invalid secret reference id: ${referenceId}.`);
      }

      if (
        mapping === undefined ||
        mapping.provider.trim() === "" ||
        !isSafeEnvironmentName(mapping.environmentVariable)
      ) {
        throw new RangeError(`Invalid secret mapping for reference: ${referenceId}.`);
      }
    }
  }

  async resolve(reference: SecretReference): Promise<string> {
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

    const mapping = this.references.get(reference.id);

    if (mapping === undefined) {
      throw new SecretResolverError(
        "REFERENCE_NOT_CONFIGURED",
        `Secret reference is not configured: ${reference.id}.`,
      );
    }

    if (mapping.provider !== reference.provider || mapping.kind !== reference.kind) {
      throw new SecretResolverError(
        "INVALID_REFERENCE",
        `Secret reference metadata does not match configured reference: ${reference.id}.`,
      );
    }

    const value = this.environment[mapping.environmentVariable];

    if (value === undefined || value === "") {
      throw new SecretResolverError(
        "SECRET_NOT_AVAILABLE",
        `Secret value is not available for reference: ${reference.id}.`,
      );
    }

    return value;
  }
}

function isSafeReferenceId(value: string): boolean {
  return /^[A-Za-z0-9._:-]{1,200}$/.test(value);
}

function isSafeEnvironmentName(value: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(value);
}
