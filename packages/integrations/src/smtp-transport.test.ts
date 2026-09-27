import { describe, expect, it } from "vitest";

import { validateSmtpTransportOptions } from "./smtp-transport";

describe("validateSmtpTransportOptions", () => {
  it("rejects enabling implicit TLS and STARTTLS together", () => {
    expect(() =>
      validateSmtpTransportOptions({
        host: "smtp.example.com",
        port: 587,
        secure: true,
        startTls: true,
      }),
    ).toThrow("SMTP secure and STARTTLS modes are mutually exclusive.");
  });

  it("normalizes STARTTLS configuration defaults", () => {
    expect(
      validateSmtpTransportOptions({
        host: " smtp.example.com ",
        port: 587,
        secure: false,
        startTls: true,
      }),
    ).toEqual({
      host: "smtp.example.com",
      port: 587,
      secure: false,
      startTls: true,
      authMechanism: "LOGIN",
      connectionTimeoutMs: 10000,
      maxMessageBytes: 1_000_000,
    });
  });
});
