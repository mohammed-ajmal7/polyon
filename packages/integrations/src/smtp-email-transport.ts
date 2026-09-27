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

export class SmtpEnvelopeError extends SmtpTransportError {\n  constructor(kind: "TRANSIENT" | "PERMANENT" | "PROTOCOL", smtpCode?: number) {\n    super(kind, "SMTP envelope was rejected.", smtpCode);\n    this.name = "SmtpEnvelopeError";\n  }\n}\n\nexport class SmtpAuthenticationError extends SmtpTransportError {
  constructor(kind: "TRANSIENT" | "PERMANENT" | "PROTOCOL", smtpCode?: number) {
    super(kind, "SMTP authentication failed.", smtpCode);
    this.name = "SmtpAuthenticationError";
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

    if (heloName === "") {
      throw new RangeError("SMTP HELO name must not be empty.");
    }

    if (messageIdDomain === "") {
      throw new RangeError("SMTP message ID domain must not be empty.");
    }

    this.options = {
      ...validated,
      heloName,
      messageIdDomain,
    };
    this.connectionFactory = connectionFactory;
  }

  async send(input: EmailSendInput, credential: EmailSmtpCredential): Promise<EmailSendOutput> {
    validateEnvelope(input, credential);\n\n    const message = buildMessage(input, this.options.messageIdDomain);

    if (new TextEncoder().encode(message).byteLength > this.options.maxMessageBytes) {
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
      await connection.write(message);
      await connection.write("\r\n.");
      await expectCode(connection, 250);
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

function isSmtpAddress(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= 320 &&
    !/[\\r\\n]/.test(value) &&
    /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(value)
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

function hasSmtpCapability(response: string, capability: string): boolean {
  const normalizedCapability = capability.toUpperCase();
  return response.split("\r\n").some((line) => {
    const match = /^\d{3}-?\s*(.*?)\s*$/.exec(line);
    if (match === null) {
      return false;
    }

    return match[1].toUpperCase().split(/\s+/u)[0] === normalizedCapability;
  });
}

function hasSmtpAuthMechanism(response: string, mechanism: SmtpAuthMechanism): boolean {
  return response.split("\r\n").some((line) => {
    const match = /^\d{3}-?\s*AUTH\s+(.+?)\s*$/i.exec(line);
    if (match === null) {
      return false;
    }

    return match[1].toUpperCase().split(/\s+/u).includes(mechanism);
  });
}

function buildMessage(input: EmailSendInput, messageIdDomain: string): string {
  const messageId = `<${Date.now()}-${Math.random().toString(16).slice(2)}@${messageIdDomain}>`;
  const headers = [
    `Message-ID: ${messageId}`,
    `To: ${input.to.join(", ")}`,
    ...(input.cc === undefined ? [] : [`Cc: ${input.cc.join(", ")}`]),
    ...(input.replyTo === undefined ? [] : [`Reply-To: ${input.replyTo}`]),
    `Subject: ${input.subject.replace(/[\r\n]/g, " ")}`,
    "MIME-Version: 1.0",
  ];

  if (input.html === undefined) {
    return [
      ...headers,
      "Content-Type: text/plain; charset=utf-8",
      "",
      normalizeBody(input.text),
    ].join("\r\n");
  }

  return [
    ...headers,
    'Content-Type: multipart/alternative; boundary="polyon-boundary"',
    "",
    "--polyon-boundary",
    "Content-Type: text/plain; charset=utf-8",
    "",
    normalizeBody(input.text),
    "--polyon-boundary",
    "Content-Type: text/html; charset=utf-8",
    "",
    normalizeBody(input.html),
    "--polyon-boundary--",
  ].join("\r\n");
}

function normalizeBody(value: string): string {
  return value.replace(/\r?\n/g, "\r\n").replace(/^\./gm, "..");
}

function extractMessageId(message: string): string {
  const match = /^Message-ID:\s*(<[^>]+>)/m.exec(message);

  if (match === null) {
    throw new Error("SMTP message ID was not generated.");
  }

  return match[1];
}

function encodeBase64(value: string): string {
  return btoa(value);
}
