import type {
  EmailSendInput,
  EmailSendOutput,
  EmailSmtpCredential,
  EmailTransport,
} from "./email-integration-adapter";
import {
  validateSmtpTransportOptions,
  type SmtpAuthMechanism,
  type SmtpTransportOptions,
  type ValidatedSmtpTransportOptions,
} from "./smtp-transport";

export interface SmtpConnection {
  read(): Promise<string>;
  write(command: string): Promise<void>;
  close(): Promise<void>;
  startTls(serverName: string, timeoutMs: number): Promise<void>;
}

export interface SmtpConnectionFactory {
  connect(options: ValidatedSmtpTransportOptions): Promise<SmtpConnection>;
}

export interface SmtpEmailTransportOptions extends SmtpTransportOptions {
  readonly heloName: string;
  readonly messageIdDomain: string;
}

export class SmtpTransportError extends Error {
  constructor(
    readonly kind: "TRANSIENT" | "PERMANENT" | "PROTOCOL",
    message: string,
    readonly smtpCode?: number,
  ) {
    super(message);
    this.name = "SmtpTransportError";
  }
}

export class SmtpAuthenticationError extends SmtpTransportError {
  constructor(kind: "TRANSIENT" | "PERMANENT" | "PROTOCOL", smtpCode?: number) {
    super(kind, "SMTP authentication failed.", smtpCode);
    this.name = "SmtpAuthenticationError";
  }
}

export class SmtpEnvelopeError extends SmtpTransportError {
  constructor(kind: "TRANSIENT" | "PERMANENT" | "PROTOCOL", smtpCode?: number) {
    super(kind, "SMTP envelope was rejected.", smtpCode);
    this.name = "SmtpEnvelopeError";
  }
}

export class SmtpDeliveryError extends SmtpTransportError {
  constructor(kind: "TRANSIENT" | "PERMANENT" | "PROTOCOL", smtpCode?: number) {
    super(kind, "SMTP server did not accept the message for delivery.", smtpCode);
    this.name = "SmtpDeliveryError";
  }
}

export class SmtpTransport implements EmailTransport {
  private readonly options: ValidatedSmtpTransportOptions & {
    readonly heloName: string;
    readonly messageIdDomain: string;
  };
  private readonly connectionFactory: SmtpConnectionFactory;

  constructor(options: SmtpEmailTransportOptions, connectionFactory: SmtpConnectionFactory) {
    const validated = validateSmtpTransportOptions(options);
    const heloName = options.heloName.trim();
    const messageIdDomain = options.messageIdDomain.trim();

    if (
      heloName === "" ||
      !isAsciiHeaderValue(heloName) ||
      new TextEncoder().encode(`EHLO ${heloName}`).byteLength > 998
    ) {
      throw new RangeError("SMTP HELO name must be non-empty, ASCII-safe, and line-safe.");
    }

    if (!isMessageIdDomain(messageIdDomain)) {
      throw new RangeError("SMTP message ID domain must be a valid DNS-style domain.");
    }

    this.options = {
      ...validated,
      heloName,
      messageIdDomain,
    };
    this.connectionFactory = connectionFactory;
  }

  async send(input: EmailSendInput, credential: EmailSmtpCredential): Promise<EmailSendOutput> {
    validateEnvelope(input, credential);

    const message = buildMessage(input, credential.username, this.options.messageIdDomain);
    const messageBytes = new TextEncoder().encode(message).byteLength;
    const dataFrameBytes = messageBytes + 3;

    if (dataFrameBytes > this.options.maxMessageBytes) {
      throw new Error("SMTP message exceeds configured maximum size.");
    }

    const connection = await this.connectionFactory.connect(this.options);

    try {
      await expectCode(connection, 220);
      let ehloResponse = await this.command(connection, `EHLO ${this.options.heloName}`, 250);

      if (this.options.startTls) {
        if (!hasSmtpCapability(ehloResponse, "STARTTLS")) {
          throw new SmtpTransportError("PROTOCOL", "SMTP server does not support STARTTLS.");
        }
        await this.command(connection, "STARTTLS", 220);
        await connection.startTls(this.options.host, this.options.connectionTimeoutMs);
        ehloResponse = await this.command(connection, `EHLO ${this.options.heloName}`, 250);
      }

      if (!hasSmtpAuthMechanism(ehloResponse, this.options.authMechanism)) {
        throw new SmtpTransportError(
          "PROTOCOL",
          `SMTP server does not advertise AUTH ${this.options.authMechanism}.`,
        );
      }

      await authenticate(
        connection,
        this.options.authMechanism,
        credential,
      );
      await envelopeCommand(connection, `MAIL FROM:<${credential.username}>`, 250);

      for (const recipient of [...input.to, ...(input.cc ?? []), ...(input.bcc ?? [])]) {
        await envelopeCommand(connection, `RCPT TO:<${recipient}>`, 250, 251);
      }

      await this.command(connection, "DATA", 354);
      await writeData(connection, message);
      await connection.write(".\r\n");

      try {
        await expectCode(connection, 250);
      } catch (error) {
        if (error instanceof SmtpTransportError) {
          throw new SmtpDeliveryError(error.kind, error.smtpCode);
        }
        throw error;
      }
      await this.command(connection, "QUIT", 221);

      const messageId = extractMessageId(message);
      return { messageId };
    } finally {
      await connection.close();
    }
  }

  private async command(
    connection: SmtpConnection,
    command: string,
    ...codes: number[]
  ): Promise<string> {
    await connection.write(command);
    return expectCode(connection, ...codes);
  }
}

async function writeData(connection: SmtpConnection, message: string): Promise<void> {
  const maxChunkBytes = 64 * 1024;
  const bytes = new TextEncoder().encode(message);

  for (let offset = 0; offset < bytes.length; offset += maxChunkBytes) {
    const chunk = bytes.slice(offset, offset + maxChunkBytes);
    await connection.write(new TextDecoder().decode(chunk));
  }
}

async function authenticate(
  connection: SmtpConnection,
  mechanism: SmtpAuthMechanism,
  credential: EmailSmtpCredential,
): Promise<void> {
  try {
    if (mechanism === "LOGIN") {
      await login(connection, credential);
      return;
    }

    throw new SmtpAuthenticationError("PROTOCOL");
  } catch (error) {
    if (error instanceof SmtpAuthenticationError) {
      throw error;
    }

    if (error instanceof SmtpTransportError) {
      throw new SmtpAuthenticationError(error.kind, error.smtpCode);
    }

    throw error;
  }
}

async function login(connection: SmtpConnection, credential: EmailSmtpCredential): Promise<void> {
  await writeAndExpect(connection, "AUTH LOGIN", 334);
  await writeAndExpect(connection, encodeBase64(credential.username), 334);
  await writeAndExpect(connection, encodeBase64(credential.password), 235);
}

async function envelopeCommand(
  connection: SmtpConnection,
  command: string,
  ...codes: number[]
): Promise<string> {
  try {
    await connection.write(command);
    return await expectCode(connection, ...codes);
  } catch (error) {
    if (error instanceof SmtpTransportError) {
      throw new SmtpEnvelopeError(error.kind, error.smtpCode);
    }

    throw error;
  }
}

function validateEnvelope(input: EmailSendInput, credential: EmailSmtpCredential): void {
  if (!isSmtpAddress(credential.username)) {
    throw new SmtpEnvelopeError("PROTOCOL");
  }

  const recipients = [...input.to, ...(input.cc ?? []), ...(input.bcc ?? [])];

  if (recipients.length === 0 || recipients.some((recipient) => !isSmtpAddress(recipient))) {
    throw new SmtpEnvelopeError("PROTOCOL");
  }
}

function isAsciiHeaderValue(value: string): boolean {
  return /^[\x20-\x7e]*$/.test(value);
}

function isMessageIdDomain(value: string): boolean {
  if (value.length === 0 || value.length > 253 || !isAsciiHeaderValue(value)) {
    return false;
  }

  const labels = value.split(".");
  return labels.every(
    (label) =>
      label.length > 0 &&
      label.length <= 63 &&
      /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/.test(label),
  );
}

function isSmtpAddress(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= 320 &&
    !/[\r\n]/.test(value) &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
  );
}

async function writeAndExpect(
  connection: SmtpConnection,
  command: string,
  ...codes: number[]
): Promise<string> {
  await connection.write(command);
  return expectCode(connection, ...codes);
}

async function expectCode(connection: SmtpConnection, ...expectedCodes: number[]): Promise<string> {
  const lines: string[] = [];

  while (true) {
    const response = await connection.read();
    lines.push(response);

    const match = /^(\d{3})([ -])(.*?)(?:\r?\n)?$/.exec(response);

    if (match === null) {
      throw new SmtpTransportError("PROTOCOL", "SMTP server returned an invalid response.");
    }

    const code = Number(match[1]);

    if (!expectedCodes.includes(code)) {
      throw classifySmtpResponse(code);
    }

    if (match[2] === " ") {
      return lines.map((line) => line.replace(/\r?\n$/, "")).join("\r\n");
    }
  }
}

function classifySmtpResponse(code: number): SmtpTransportError {
  if (code >= 400 && code <= 499) {
    return new SmtpTransportError(
      "TRANSIENT",
      "SMTP server temporarily rejected the operation.",
      code,
    );
  }

  if (code >= 500 && code <= 599) {
    return new SmtpTransportError("PERMANENT", "SMTP server rejected the operation.", code);
  }

  return new SmtpTransportError("PROTOCOL", "SMTP server returned an unexpected response.", code);
}

function smtpCapabilityPayload(line: string): string | undefined {
  const match = /^\d{3}-?\s*(.*?)\s*$/.exec(line);
  return match?.[1];
}

function hasSmtpCapability(response: string, capability: string): boolean {
  const normalizedCapability = capability.toUpperCase();
  return response.split("\r\n").some((line) => {
    const payload = smtpCapabilityPayload(line);
    if (payload === undefined) return false;
    return payload.toUpperCase().split(/\s+/u).includes(normalizedCapability);
  });
}

function hasSmtpAuthMechanism(response: string, mechanism: SmtpAuthMechanism): boolean {
  return response.split("\r\n").some((line) => {
    const payload = smtpCapabilityPayload(line);
    if (payload === undefined) return false;
    const match = /\bAUTH\s+(.+?)\s*$/i.exec(payload);
    if (match === null) return false;
    return match[1].toUpperCase().split(/\s+/u).includes(mechanism);
  });
}

function buildMessage(
  input: EmailSendInput,
  sender: string,
  messageIdDomain: string,
): string {
  const messageId = `<${Date.now()}-${Math.random().toString(16).slice(2)}@${messageIdDomain}>`;
  const headers = [
    `Message-ID: ${messageId}`,
    `From: ${sender}`,
    ...foldAddressHeader("To", input.to),
    ...(input.cc === undefined ? [] : foldAddressHeader("Cc", input.cc)),
    ...(input.replyTo === undefined ? [] : [`Reply-To: ${input.replyTo}`]),
    ...foldTextHeader("Subject", encodeHeaderText(input.subject)),
    "MIME-Version: 1.0",
  ];

  if (input.html === undefined) {
    return [
      ...headers,
      "Content-Type: text/plain; charset=utf-8",
      "Content-Transfer-Encoding: base64",
      "",
      encodeMimeBody(input.text),
    ].join("\r\n") + "\r\n";
  }

  const boundary = `=_POLYON_${messageId.slice(1, -1).replace(/[^A-Za-z0-9]/g, "")}`;

  return [
    ...headers,
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: base64",
    "",
    encodeMimeBody(input.text),
    `--${boundary}`,
    "Content-Type: text/html; charset=utf-8",
    "Content-Transfer-Encoding: base64",
    "",
    encodeMimeBody(input.html),
    `--${boundary}--`,
    "",
  ].join("\r\n");
}

function foldTextHeader(name: string, value: string): string[] {
  const prefix = `${name}: `;
  const maxLineBytes = 998;
  const existingLines = value.split("\r\n ");
  if (existingLines.length > 1) {
    return existingLines.map((line, index) => (index === 0 ? prefix + line : " " + line));
  }

  const words = value.split(/\s+/u);
  const lines: string[] = [];
  let current = prefix;

  for (const word of words) {
    const separator = current === prefix ? "" : " ";
    const candidate = current + separator + word;
    if (current !== prefix && new TextEncoder().encode(candidate).byteLength > maxLineBytes) {
      lines.push(current);
      current = " " + word;
      continue;
    }
    if (current === prefix && new TextEncoder().encode(candidate).byteLength > maxLineBytes) {
      throw new RangeError(`SMTP ${name} header contains an overlong value.`);
    }
    current = candidate;
  }

  lines.push(current);
  return lines;
}

function foldAddressHeader(name: string, addresses: readonly string[]): string[] {
  return foldHeaderValue(name, addresses.join(", "));
}

function foldHeaderValue(name: string, value: string): string[] {
  const firstPrefix = `${name}: `;
  const continuationPrefix = " ";
  const maxLineBytes = 998;

  if (new TextEncoder().encode(`${firstPrefix}${value}`).byteLength <= maxLineBytes) {
    return [`${firstPrefix}${value}`];
  }

  const words = value.split(", ");
  const lines: string[] = [];
  let current = firstPrefix;

  for (const word of words) {
    const separator = current === firstPrefix ? "" : ", ";
    const candidate = current + separator + word;

    if (current !== firstPrefix && new TextEncoder().encode(candidate).byteLength > maxLineBytes) {
      lines.push(current);
      current = continuationPrefix + word;
      continue;
    }

    if (current === firstPrefix && new TextEncoder().encode(candidate).byteLength > maxLineBytes) {
      throw new RangeError(`SMTP ${name} header contains an overlong value.`);
    }

    current = candidate;
  }

  lines.push(current);
  return lines;
}

function encodeHeaderText(value: string): string {
  if (isAsciiHeaderValue(value)) {
    return value;
  }

  const bytes = new TextEncoder().encode(value);
  return splitUtf8Bytes(bytes, 45)
    .map((chunk) => `=?UTF-8?B?${bytesToBase64(chunk)}?=`)
    .join("\r\n ");
}

function encodeMimeBody(value: string): string {
  const normalized = value.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const encoded = bytesToBase64(new TextEncoder().encode(normalized));
  return encoded.match(/.{1,76}/g)?.join("\r\n") ?? "";
}

function splitUtf8Bytes(bytes: Uint8Array, maxBytes: number): Uint8Array[] {
  const chunks: Uint8Array[] = [];
  let start = 0;

  while (start < bytes.length) {
    let end = Math.min(start + maxBytes, bytes.length);
    while (end > start && (bytes[end] & 0xc0) === 0x80) {
      end -= 1;
    }
    chunks.push(bytes.slice(start, end));
    start = end;
  }

  return chunks;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;

  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }

  return btoa(binary);
}


function extractMessageId(message: string): string {
  const match = /^Message-ID:\s*(<[^>]+>)/m.exec(message);

  if (match === null) {
    throw new Error("SMTP message ID was not generated.");
  }

  return match[1];
}

function encodeBase64(value: string): string {
  return bytesToBase64(new TextEncoder().encode(value));
}
