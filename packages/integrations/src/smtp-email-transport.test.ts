import { describe, expect, it, vi } from "vitest";

import {
  SmtpAuthenticationError,
  SmtpTransport,
  SmtpTransportError,
} from "./smtp-email-transport";

function createConnection(responses: string[]) {
  return {
    read: vi.fn(async () => {
      const response = responses.shift();
      if (response === undefined) {
        throw new Error("No SMTP response available.");
      }
      return response;
    }),
    write: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
    startTls: vi.fn(async () => undefined),
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
    expect(connection.write).toHaveBeenCalledWith("\r\n.");
    expect(connection.close).toHaveBeenCalledTimes(1);
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
      name: "SmtpTransportError",
      kind: "PERMANENT",
      smtpCode: 500,
    });

    expect(connection.close).toHaveBeenCalledTimes(1);
  });
});
