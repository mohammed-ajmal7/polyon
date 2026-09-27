export type SmtpAuthMechanism = "LOGIN";

export interface SmtpTransportOptions {
  readonly host: string;
  readonly port: number;
  readonly secure: boolean;
  readonly startTls?: boolean;
  readonly authMechanism?: SmtpAuthMechanism;
  readonly connectionTimeoutMs?: number;
  readonly maxMessageBytes?: number;
}

const DEFAULT_CONNECTION_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_MESSAGE_BYTES = 1_000_000;
const MAX_CONNECTION_TIMEOUT_MS = 60_000;
const MAX_MESSAGE_BYTES = 10_000_000;

export interface ValidatedSmtpTransportOptions {
  readonly host: string;
  readonly port: number;
  readonly secure: boolean;
  readonly startTls: boolean;
  readonly authMechanism: SmtpAuthMechanism;
  readonly connectionTimeoutMs: number;
  readonly maxMessageBytes: number;
}

export function validateSmtpTransportOptions(
  options: SmtpTransportOptions,
): ValidatedSmtpTransportOptions {
  const host = options.host.trim();
  const startTls = options.startTls ?? false;
  const authMechanism = options.authMechanism ?? "LOGIN";

  if (host === "") {
    throw new RangeError("SMTP host must not be empty.");
  }

  if (!Number.isInteger(options.port) || options.port < 1 || options.port > 65_535) {
    throw new RangeError("SMTP port must be an integer between 1 and 65535.");
  }

  if (options.secure && startTls) {
    throw new RangeError("SMTP secure and STARTTLS modes are mutually exclusive.");
  }

  if (!options.secure && !startTls) {
    throw new RangeError("Authenticated SMTP transport requires TLS via secure or STARTTLS.");
  }

  const connectionTimeoutMs = options.connectionTimeoutMs ?? DEFAULT_CONNECTION_TIMEOUT_MS;

  if (
    !Number.isInteger(connectionTimeoutMs) ||
    connectionTimeoutMs < 1 ||
    connectionTimeoutMs > MAX_CONNECTION_TIMEOUT_MS
  ) {
    throw new RangeError(
      `SMTP connection timeout must be an integer between 1 and ${MAX_CONNECTION_TIMEOUT_MS} ms.`,
    );
  }

  const maxMessageBytes = options.maxMessageBytes ?? DEFAULT_MAX_MESSAGE_BYTES;

  if (
    !Number.isInteger(maxMessageBytes) ||
    maxMessageBytes < 1 ||
    maxMessageBytes > MAX_MESSAGE_BYTES
  ) {
    throw new RangeError(
      `SMTP message size must be an integer between 1 and ${MAX_MESSAGE_BYTES} bytes.`,
    );
  }

  return {
    host,
    port: options.port,
    secure: options.secure,
    startTls,
    authMechanism,
    connectionTimeoutMs,
    maxMessageBytes,
  };
}
