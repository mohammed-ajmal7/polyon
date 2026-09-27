import { describe, expect, it, vi } from "vitest";

import {
  SmtpAuthenticationError,
  SmtpDeliveryError,
  SmtpTransport,
  SmtpTransportError,
} from "./smtp-email-transport";

type TestConnection = {
  read: ReturnType<typeof vi.fn<() => Promise<string>>>;
  write: ReturnType<typeof vi.fn<(command: string) => Promise<void>>>;
  close: ReturnType<typeof vi.fn<() => Promise<void>>>;
  startTls: ReturnType<typeof vi.fn<(serverName: string, timeoutMs: number) => Promise<void>>>;
};

function createConnection(responses: string[]): TestConnection {
  return {
    read: vi.fn(async () => {
      const response = responses.shift();
      if (response === undefined) {
        throw new Error("No SMTP response available.");
      }
      return response;
    }),
    write: vi.fn(async (_command: string) => undefined),
    close: vi.fn(async () => undefined),
    startTls: vi.fn(async (_serverName: string, _timeoutMs: number) => undefined),
  };
}
describe("SmtpTransport", () => {
  it("requires and negotiates STARTTLS before authentication", async () => {
    const connection = createConnection([
      "220 ready",
      "250-smtp.example.com",
      "250-STARTTLS",
      "250 AUTH LOGIN",
      "220 ready to start TLS",
      "250 smtp.example.com AUTH LOGIN",
      "334 VXNlcm5hbWU6",
      "334 UGFzc3dvcmQ6",
      "235 authenticated",
      "250 sender accepted",
      "250 recipient accepted",
      "354 continue",
      "250 queued",
      "221 bye",
    ]);
    const factory = { connect: vi.fn(async () => connection) };

    const transport = new SmtpTransport(
      {
        host: "smtp.example.com",
        port: 587,
        secure: false,
        startTls: true,
        heloName: "polyon.local",
        messageIdDomain: "polyon.local",
      },
      factory,
    );

    await transport.send(
      { to: ["user@example.com"], subject: "Hello", text: "Hello" },
      { username: "mailer@example.com", password: "secret" },
    );

    expect(connection.write).toHaveBeenNthCalledWith(2, "STARTTLS");
    expect(connection.startTls).toHaveBeenCalledWith("smtp.example.com", 10000);
    expect(connection.write).toHaveBeenNthCalledWith(3, "EHLO polyon.local");
    expect(connection.write).toHaveBeenNthCalledWith(4, "AUTH LOGIN");
  });

  it("rejects STARTTLS when the server does not advertise it", async () => {
    const connection = createConnection(["220 ready", "250 smtp.example.com AUTH LOGIN"]);
    const factory = { connect: vi.fn(async () => connection) };

    const transport = new SmtpTransport(
      {
        host: "smtp.example.com",
        port: 587,
        secure: false,
        startTls: true,
        heloName: "polyon.local",
        messageIdDomain: "polyon.local",
      },
      factory,
    );

    await expect(
      transport.send(
        { to: ["user@example.com"], subject: "Hello", text: "Hello" },
        { username: "mailer@example.com", password: "secret" },
      ),
    ).rejects.toThrow("SMTP server does not support STARTTLS.");

    expect(connection.startTls).not.toHaveBeenCalled();
    expect(connection.close).toHaveBeenCalledTimes(1);
  });

  it("rejects authentication when the server does not advertise LOGIN", async () => {
    const connection = createConnection(["220 ready", "250 smtp.example.com"]);
    const factory = { connect: vi.fn(async () => connection) };

    const transport = new SmtpTransport(
      {
        host: "smtp.example.com",
        port: 465,
        secure: true,
        heloName: "polyon.local",
        messageIdDomain: "polyon.local",
      },
      factory,
    );

    await expect(
      transport.send(
        { to: ["user@example.com"], subject: "Hello", text: "Hello" },
        { username: "mailer@example.com", password: "secret" },
      ),
    ).rejects.toThrow("SMTP server does not advertise AUTH LOGIN.");

    expect(connection.write).not.toHaveBeenCalledWith("AUTH LOGIN");
    expect(connection.close).toHaveBeenCalledTimes(1);
  });

  it("sanitizes authentication failures while preserving permanent classification", async () => {
    const connection = createConnection([
      "220 ready",
      "250 smtp.example.com AUTH LOGIN",
      "535 5.7.8 invalid credentials for mailer@example.com",
    ]);
    const factory = { connect: vi.fn(async () => connection) };

    const transport = new SmtpTransport(
      {
        host: "smtp.example.com",
        port: 465,
        secure: true,
        heloName: "polyon.local",
        messageIdDomain: "polyon.local",
      },
      factory,
    );

    try {
      await transport.send(
        { to: ["user@example.com"], subject: "Hello", text: "Hello" },
        { username: "mailer@example.com", password: "secret" },
      );
      throw new Error("Expected SMTP authentication to fail.");
    } catch (error) {
      expect(error).toBeInstanceOf(SmtpAuthenticationError);
      expect(error).toMatchObject({
        kind: "PERMANENT",
        smtpCode: 535,
        message: "SMTP authentication failed.",
      });
      expect((error as Error).message).not.toContain("mailer@example.com");
      expect((error as Error).message).not.toContain("invalid credentials");
    }
  });

  it("classifies transient authentication failures without leaking the server response", async () => {
    const connection = createConnection([
      "220 ready",
      "250 smtp.example.com AUTH LOGIN",
      "334 VXNlcm5hbWU6",
      "451 temporary server failure; internal queue id 123",
    ]);
    const factory = { connect: vi.fn(async () => connection) };

    const transport = new SmtpTransport(
      {
        host: "smtp.example.com",
        port: 465,
        secure: true,
        heloName: "polyon.local",
        messageIdDomain: "polyon.local",
      },
      factory,
    );

    try {
      await transport.send(
        { to: ["user@example.com"], subject: "Hello", text: "Hello" },
        { username: "mailer@example.com", password: "secret" },
      );
      throw new Error("Expected SMTP authentication to fail.");
    } catch (error) {
      expect(error).toBeInstanceOf(SmtpAuthenticationError);
      expect(error).toMatchObject({
        kind: "TRANSIENT",
        smtpCode: 451,
        message: "SMTP authentication failed.",
      });
      expect((error as Error).message).not.toContain("internal queue id");
    }
  });

  it("performs a bounded authenticated SMTP send", async () => {
    const connection = createConnection([
      "220 smtp.example.com ready",
      "250 smtp.example.com AUTH LOGIN",
      "334 VXNlcm5hbWU6",
      "334 UGFzc3dvcmQ6",
      "235 authenticated",
      "250 sender accepted",
      "250 recipient accepted",
      "354 continue",
      "250 queued",
      "221 bye",
    ]);
    const factory = {
      connect: vi.fn(async () => connection),
    };

    const transport = new SmtpTransport(
      {
        host: "smtp.example.com",
        port: 465,
        secure: true,
        heloName: "polyon.local",
        messageIdDomain: "polyon.local",
      },
      factory,
    );

    const result = await transport.send(
      {
        to: ["user@example.com"],
        subject: "Hello",
        text: "Hello from POLYON",
      },
      {
        username: "mailer@example.com",
        password: "secret",
      },
    );

    expect(result.messageId).toMatch(/^<[^>]+@polyon\.local>$/);
    expect(connection.write).toHaveBeenCalledWith("EHLO polyon.local");
    expect(connection.write).toHaveBeenCalledWith("AUTH LOGIN");
    expect(connection.write).toHaveBeenCalledWith("bWFpbGVyQGV4YW1wbGUuY29t");
    expect(connection.write).toHaveBeenCalledWith("c2VjcmV0");
    expect(connection.write).toHaveBeenCalledWith("MAIL FROM:<mailer@example.com>");
    expect(connection.write).toHaveBeenCalledWith("RCPT TO:<user@example.com>");
    expect(connection.write).toHaveBeenCalledWith("DATA");
    expect(connection.write).toHaveBeenCalledWith(".\r\n");
    expect(connection.close).toHaveBeenCalledTimes(1);
  });


  it("builds UTF-8-safe MIME content and a complete DATA terminator", async () => {
    const connection = createConnection([
      "220 ready",
      "250 hello AUTH LOGIN",
      "334 VXNlcm5hbWU6",
      "334 UGFzc3dvcmQ6",
      "235 authenticated",
      "250 sender accepted",
      "250 recipient accepted",
      "354 continue",
      "250 queued",
      "221 bye",
    ]);
    const transport = new SmtpTransport(
      {
        host: "smtp.example.com",
        port: 465,
        secure: true,
        heloName: "polyon.local",
        messageIdDomain: "polyon.local",
      },
      { connect: vi.fn(async () => connection) },
    );

    await transport.send(
      {
        to: ["user@example.com"],
        subject: "Café — Привет",
        text: "Hello\n.Second line",
      },
      { username: "mailer@example.com", password: "secret" },
    );

    const message = connection.write.mock.calls
      .map(([value]) => value)
      .filter((value): value is string => value.startsWith("Message-ID:"))
      .join("");

    expect(message).toContain("From: mailer@example.com\r\n");
    expect(message).toContain("Content-Transfer-Encoding: base64\r\n");
    expect(message).toContain("Subject: =?UTF-8?B?");
    expect(message).toContain("\r\n\r\nSGVsbG8KLlNlY29uZCBsaW5l\r\n");
    expect(message?.endsWith("\r\n")).toBe(true);
    expect(connection.write).toHaveBeenLastCalledWith(".\r\n");
  });

  it("chunks large SMTP DATA payloads within the connection write bound", async () => {
    const connection = createConnection([
      "220 ready",
      "250 hello AUTH LOGIN",
      "334 VXNlcm5hbWU6",
      "334 UGFzc3dvcmQ6",
      "235 authenticated",
      "250 sender accepted",
      "250 recipient accepted",
      "354 continue",
      "250 queued",
      "221 bye",
    ]);
    const transport = new SmtpTransport(
      {
        host: "smtp.example.com",
        port: 465,
        secure: true,
        heloName: "polyon.local",
        messageIdDomain: "polyon.local",
      },
      { connect: vi.fn(async () => connection) },
    );

    await transport.send(
      { to: ["user@example.com"], subject: "Large", text: "x".repeat(80_000) },
      { username: "mailer@example.com", password: "secret" },
    );

    const dataWrites = connection.write.mock.calls
      .map(([value]) => value)
      .filter(
        (value): value is string =>
          value !== "DATA" &&
          value !== ".\r\n" &&
          !value.startsWith("EHLO") &&
          !value.startsWith("AUTH") &&
          !value.startsWith("MAIL FROM") &&
          !value.startsWith("RCPT TO") &&
          value !== "bWFpbGVyQGV4YW1wbGUuY29t" &&
          value !== "c2VjcmV0",
      );
    expect(dataWrites.length).toBeGreaterThan(1);
    expect(
      dataWrites.every((value) => new TextEncoder().encode(value).byteLength <= 64 * 1024),
    ).toBe(true);
  });

  it("folds long subject and recipient headers below the SMTP line limit", async () => {
    const connection = createConnection([
      "220 ready",
      "250 hello AUTH LOGIN",
      "334 VXNlcm5hbWU6",
      "334 UGFzc3dvcmQ6",
      "235 authenticated",
      "250 sender accepted",
      "250 recipient accepted",
      "354 continue",
      "250 queued",
      "221 bye",
    ]);
    const transport = new SmtpTransport(
      {
        host: "smtp.example.com",
        port: 465,
        secure: true,
        heloName: "polyon.local",
        messageIdDomain: "polyon.local",
      },
      { connect: vi.fn(async () => connection) },
    );
    await transport.send(
      {
        to: ["user@example.com"],
        subject: Array.from({ length: 199 }, () => "long").join(" "),
        text: "hello",
      },
      { username: "mailer@example.com", password: "secret" },
    );

    const messageWrites = connection.write.mock.calls
      .map(([value]) => value)
      .filter(
        (value) =>
          value.includes("Message-ID:") ||
          value.includes("Subject:") ||
          value.includes("To:"),
      );
    const message = messageWrites.join("");
    expect(
      message.split("\r\n").every((line) => new TextEncoder().encode(line).byteLength <= 998),
    ).toBe(true);
  });

  it("uses UTF-8 bytes for AUTH LOGIN credentials", async () => {
    const connection = createConnection([
      "220 ready",
      "250 hello AUTH LOGIN",
      "334 VXNlcm5hbWU6",
      "334 UGFzc3dvcmQ6",
      "235 authenticated",
      "250 sender accepted",
      "250 recipient accepted",
      "354 continue",
      "250 queued",
      "221 bye",
    ]);
    const transport = new SmtpTransport(
      {
        host: "smtp.example.com",
        port: 465,
        secure: true,
        heloName: "polyon.local",
        messageIdDomain: "polyon.local",
      },
      { connect: vi.fn(async () => connection) },
    );

    await transport.send(
      { to: ["user@example.com"], subject: "Hello", text: "Hello" },
      { username: "mailer@example.com", password: "pässword" },
    );

    expect(connection.write).toHaveBeenCalledWith("cMOkc3N3b3Jk");
  });

  it("classifies permanent DATA delivery failures separately", async () => {
    const connection = createConnection([
      "220 ready",
      "250 hello AUTH LOGIN",
      "334 VXNlcm5hbWU6",
      "334 UGFzc3dvcmQ6",
      "235 authenticated",
      "250 sender accepted",
      "250 recipient accepted",
      "354 continue",
      "550 message rejected after DATA",
    ]);
    const transport = new SmtpTransport(
      {
        host: "smtp.example.com",
        port: 465,
        secure: true,
        heloName: "polyon.local",
        messageIdDomain: "polyon.local",
      },
      { connect: vi.fn(async () => connection) },
    );

    await expect(
      transport.send(
        { to: ["user@example.com"], subject: "Hello", text: "Hello" },
        { username: "mailer@example.com", password: "secret" },
      ),
    ).rejects.toMatchObject({
      name: "SmtpDeliveryError",
      kind: "PERMANENT",
      smtpCode: 550,
      message: "SMTP server did not accept the message for delivery.",
    });
  });

  it("rejects an invalid SMTP envelope before opening a connection", async () => {
    const connection = createConnection([]);
    const factory = { connect: vi.fn(async () => connection) };

    const transport = new SmtpTransport(
      {
        host: "smtp.example.com",
        port: 465,
        secure: true,
        heloName: "polyon.local",
        messageIdDomain: "polyon.local",
      },
      factory,
    );

    await expect(
      transport.send(
        { to: ["attacker\r\nBcc: victim@example.com"], subject: "Hello", text: "Hello" },
        { username: "mailer@example.com", password: "secret" },
      ),
    ).rejects.toMatchObject({
      name: "SmtpEnvelopeError",
      kind: "PROTOCOL",
      message: "SMTP envelope was rejected.",
    });

    expect(factory.connect).not.toHaveBeenCalled();
  });

  it("classifies permanent RCPT failures as envelope errors", async () => {
    const connection = createConnection([
      "220 ready",
      "250 hello AUTH LOGIN",
      "334 VXNlcm5hbWU6",
      "334 UGFzc3dvcmQ6",
      "235 authenticated",
      "250 sender accepted",
      "550 mailbox unavailable; internal recipient data",
    ]);
    const factory = { connect: vi.fn(async () => connection) };

    const transport = new SmtpTransport(
      {
        host: "smtp.example.com",
        port: 465,
        secure: true,
        heloName: "polyon.local",
        messageIdDomain: "polyon.local",
      },
      factory,
    );

    await expect(
      transport.send(
        { to: ["user@example.com"], subject: "Hello", text: "Hello" },
        { username: "mailer@example.com", password: "secret" },
      ),
    ).rejects.toMatchObject({
      name: "SmtpEnvelopeError",
      kind: "PERMANENT",
      smtpCode: 550,
      message: "SMTP envelope was rejected.",
    });
  });

  it("classifies transient MAIL FROM failures as envelope errors", async () => {
    const connection = createConnection([
      "220 ready",
      "250 hello AUTH LOGIN",
      "334 VXNlcm5hbWU6",
      "334 UGFzc3dvcmQ6",
      "235 authenticated",
      "451 temporary sender failure; internal queue id",
    ]);
    const factory = { connect: vi.fn(async () => connection) };

    const transport = new SmtpTransport(
      {
        host: "smtp.example.com",
        port: 465,
        secure: true,
        heloName: "polyon.local",
        messageIdDomain: "polyon.local",
      },
      factory,
    );

    await expect(
      transport.send(
        { to: ["user@example.com"], subject: "Hello", text: "Hello" },
        { username: "mailer@example.com", password: "secret" },
      ),
    ).rejects.toMatchObject({
      name: "SmtpEnvelopeError",
      kind: "TRANSIENT",
      smtpCode: 451,
      message: "SMTP envelope was rejected.",
    });
  });

  it("closes the connection when the SMTP server rejects a command", async () => {
    const connection = createConnection([
      "220 ready",
      "250 hello AUTH LOGIN",
      "334 VXNlcm5hbWU6",
      "334 UGFzc3dvcmQ6",
      "235 authenticated",
      "500 rejected",
    ]);
    const factory = {
      connect: vi.fn(async () => connection),
    };

    const transport = new SmtpTransport(
      {
        host: "smtp.example.com",
        port: 465,
        secure: true,
        heloName: "polyon.local",
        messageIdDomain: "polyon.local",
      },
      factory,
    );

    await expect(
      transport.send(
        {
          to: ["user@example.com"],
          subject: "Hello",
          text: "Hello",
        },
        {
          username: "mailer@example.com",
          password: "secret",
        },
      ),
    ).rejects.toMatchObject({
      name: "SmtpEnvelopeError",
      kind: "PERMANENT",
      smtpCode: 500,
      message: "SMTP envelope was rejected.",
    });

    expect(connection.close).toHaveBeenCalledTimes(1);
  });
});
