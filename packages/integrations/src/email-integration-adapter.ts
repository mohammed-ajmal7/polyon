import type { SecretReference } from "@polyon/contracts";

import type {
  IntegrationAdapter,
  IntegrationInvocationRequest,
  IntegrationInvocationResult,
} from "./integration-adapter";
import type { SecretResolver } from "./secret-resolver";

export type EmailOperation = "SEND_EMAIL";

export interface EmailSendInput {
  readonly to: readonly string[];
  readonly subject: string;
  readonly text: string;
  readonly html?: string;
  readonly cc?: readonly string[];
  readonly bcc?: readonly string[];
  readonly replyTo?: string;
}

export interface EmailSendOutput {
  readonly messageId: string;
}

export interface EmailTransport {
  send(input: EmailSendInput, credential: string): Promise<EmailSendOutput>;
}

export type EmailIntegrationAdapterErrorKind =
  | "INVALID_INPUT"
  | "AUTHENTICATION_ERROR"
  | "TRANSPORT_ERROR";

export class EmailIntegrationAdapterError extends Error {
  readonly kind: EmailIntegrationAdapterErrorKind;

  constructor(kind: EmailIntegrationAdapterErrorKind, message: string) {
    super(message);
    this.name = "EmailIntegrationAdapterError";
    this.kind = kind;
  }
}

export interface EmailIntegrationAdapterOptions {
  readonly integrationId: string;
  readonly secretResolver: SecretResolver;
  readonly secretReference: SecretReference;
  readonly transport: EmailTransport;
}

const MAX_RECIPIENTS = 50;
const MAX_SUBJECT_LENGTH = 998;
const MAX_BODY_LENGTH = 100_000;

export class EmailIntegrationAdapter implements IntegrationAdapter {
  readonly integrationId: string;
  readonly kind = "EMAIL" as const;
  readonly actionKinds = ["EXTERNAL_COMMUNICATION"] as const;
  readonly supportedOperations = ["SEND_EMAIL"] as const;
  readonly sideEffectClass = "NON_IDEMPOTENT" as const;

  private readonly secretResolver: SecretResolver;
  private readonly secretReference: SecretReference;
  private readonly transport: EmailTransport;

  constructor(options: EmailIntegrationAdapterOptions) {
    if (options.integrationId.trim() === "") {
      throw new RangeError("integrationId must not be empty.");
    }

    if (options.secretReference.provider !== "email") {
      throw new RangeError("Email integration requires an email secret reference.");
    }

    if (options.secretReference.kind !== "SMTP_CREDENTIAL") {
      throw new RangeError("Email integration requires an SMTP credential reference.");
    }

    this.integrationId = options.integrationId;
    this.secretResolver = options.secretResolver;
    this.secretReference = options.secretReference;
    this.transport = options.transport;
  }

  async invoke(
    request: IntegrationInvocationRequest<unknown>,
  ): Promise<IntegrationInvocationResult<EmailSendOutput>> {
    if (request.operation !== "SEND_EMAIL") {
      throw new EmailIntegrationAdapterError(
        "INVALID_INPUT",
        `Unsupported Email operation: ${request.operation}.`,
      );
    }

    const input = parseSendEmailInput(request.input);
    const credential = await this.secretResolver.resolve(this.secretReference);

    try {
      return {
        output: await this.transport.send(input, credential),
      };
    } catch (error) {
      if (error instanceof EmailIntegrationAdapterError) {
        throw error;
      }

      throw new EmailIntegrationAdapterError(
        "TRANSPORT_ERROR",
        "Email transport failed.",
      );
    }
  }
}

function parseSendEmailInput(input: unknown): EmailSendInput {
  if (input === null || typeof input !== "object") {
    throw new EmailIntegrationAdapterError(
      "INVALID_INPUT",
      "SEND_EMAIL requires an object input.",
    );
  }

  const value = input as Record<string, unknown>;
  const to = parseRecipients(value.to, "to", true);
  const cc = parseRecipients(value.cc, "cc", false);
  const bcc = parseRecipients(value.bcc, "bcc", false);

  if (typeof value.subject !== "string" || value.subject.length === 0) {
    throw new EmailIntegrationAdapterError(
      "INVALID_INPUT",
      "Email subject must contain at least one character.",
    );
  }

  if (Array.from(value.subject).length > MAX_SUBJECT_LENGTH) {
    throw new EmailIntegrationAdapterError(
      "INVALID_INPUT",
      `Email subject must contain at most ${MAX_SUBJECT_LENGTH} characters.`,
    );
  }

  if (typeof value.text !== "string" || value.text.length === 0) {
    throw new EmailIntegrationAdapterError(
      "INVALID_INPUT",
      "Email text body must contain at least one character.",
    );
  }

  if (Array.from(value.text).length > MAX_BODY_LENGTH) {
    throw new EmailIntegrationAdapterError(
      "INVALID_INPUT",
      `Email text body must contain at most ${MAX_BODY_LENGTH} characters.`,
    );
  }

  if (value.html !== undefined) {
    if (typeof value.html !== "string" || Array.from(value.html).length > MAX_BODY_LENGTH) {
      throw new EmailIntegrationAdapterError(
        "INVALID_INPUT",
        `Email HTML body must contain at most ${MAX_BODY_LENGTH} characters.`,
      );
    }
  }

  const replyTo = value.replyTo === undefined ? undefined : parseAddress(value.replyTo, "replyTo");

  return {
    to: to as readonly string[],
    subject: value.subject,
    text: value.text,
    ...(value.html === undefined ? {} : { html: value.html as string }),
    ...(cc === undefined ? {} : { cc }),
    ...(bcc === undefined ? {} : { bcc }),
    ...(replyTo === undefined ? {} : { replyTo }),
  };
}

function parseRecipients(
  value: unknown,
  field: string,
  required: boolean,
): readonly string[] | undefined {
  if (value === undefined && !required) {
    return undefined;
  }

  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_RECIPIENTS) {
    throw new EmailIntegrationAdapterError(
      "INVALID_INPUT",
      `Email ${field} must contain 1-${MAX_RECIPIENTS} recipients.`,
    );
  }

  return value.map((candidate, index) => parseAddress(candidate, `${field}[${index}]`));
}

function parseAddress(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 320) {
    throw new EmailIntegrationAdapterError(
      "INVALID_INPUT",
      `Email ${field} must contain a valid address.`,
    );
  }

  if (/[\r\n]/.test(value) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
    throw new EmailIntegrationAdapterError(
      "INVALID_INPUT",
      `Email ${field} must contain a valid address.`,
    );
  }

  return value;
}
