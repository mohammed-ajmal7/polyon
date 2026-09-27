import type {
  EmailSendInput,
  EmailSendOutput,
  EmailSmtpCredential,
  EmailTransport,
} from "./email-integration-adapter";
import {
  validateSmtpTransportOptions,
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
    const message = buildMessage(input, this.options.messageIdDomain);

    if (new TextEncoder().encode(message).byteLength > this.options.maxMessageBytes) {
      throw new Error("SMTP message exceeds configured maximum size.");
    }

    const connection = await this.connectionFactory.connect(this.options);

    try {
      await expectCode(connection, 220);
      const ehloResponse = await this.command(connection, `EHLO ${this.options.heloName}`, 250);

      if (this.options.startTls) {
        if (!hasSmtpCapability(ehloResponse, "STARTTLS")) {
          throw new Error("SMTP server does not support STARTTLS.");
        }
        await this.command(connection, "STARTTLS", 220);
        await connection.startTls(this.options.host, this.options.connectionTimeoutMs);
        await this.command(connection, `EHLO ${this.options.heloName}`, 250);
      }

      await this.command(connection, `AUTH LOGIN`, 334);
      await this.command(connection, encodeBase64(credential.username), 334);
      await this.command(connection, encodeBase64(credential.password), 235);
      await this.command(connection, `MAIL FROM:<${credential.username}>`, 250);

      for (const recipient of [...input.to, ...(input.cc ?? []), ...(input.bcc ?? [])]) {
        await this.command(connection, `RCPT TO:<${recipient}>`, 250, 251);
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

async function expectCode(connection: SmtpConnection, ...expectedCodes: number[]): Promise<string> {
  const lines: string[] = [];

  while (true) {
    const response = await connection.read();
    lines.push(response);

    const match = /^(\d{3})([ -])(.*?)(?:\r?\n)?$/.exec(response);

    if (match === null || !expectedCodes.includes(Number(match[1]))) {
      throw new Error("SMTP server returned an unexpected response.");
    }

    if (match[2] === " ") {
      return lines.join("");
    }
  }
}

function hasSmtpCapability(response: string, capability: string): boolean {
  return response
    .split(/\r?\n/)
    .some((line) => line.slice(4).trim().toUpperCase() === capability);
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
