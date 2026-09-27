import { describe, expect, it, vi } from "vitest";

import type { SecretReference } from "@polyon/contracts";
import {
  EmailIntegrationAdapter,
  EmailIntegrationAdapterError,
  type EmailTransport,
} from "./index";

const secretReference: SecretReference = {
  id: "email.primary",
  kind: "SMTP_CREDENTIAL",
  provider: "email",
};

describe("EmailIntegrationAdapter", () => {
  it("sends a bounded email through the injected transport", async () => {
    const transport: EmailTransport = {
      send: vi.fn(async (input, credential) => {
        expect(credential).toEqual({
          username: "mailer@example.com",
          password: "smtp-secret",
        });
        expect(input).toEqual({
          to: ["user@example.com"],
          subject: "Hello",
          text: "Hello from POLYON",
          html: "<p>Hello from POLYON</p>",
        });
        return { messageId: "message-123" };
      }),
    };
    const secretResolver = {
      resolve: vi.fn(async () => "smtp-secret"),
    };

    const adapter = new EmailIntegrationAdapter({
      integrationId: "email-primary",
      secretResolver,
      secretReference,
      smtpUsername: "mailer@example.com",
      transport,
    });

    const result = await adapter.invoke({
      invocationId: "email-invocation-1",
      operation: "SEND_EMAIL",
      input: {
        to: ["user@example.com"],
        subject: "Hello",
        text: "Hello from POLYON",
        html: "<p>Hello from POLYON</p>",
      },
    });

    expect(secretResolver.resolve).toHaveBeenCalledWith(secretReference);
    expect(result.output).toEqual({ messageId: "message-123" });
    expect(transport.send).toHaveBeenCalledTimes(1);
  });

  it("validates recipients and bodies before resolving the secret", async () => {
    const secretResolver = {
      resolve: vi.fn(async () => "smtp-secret"),
    };
    const transport: EmailTransport = {
      send: vi.fn(async () => ({ messageId: "unused" })),
    };

    const adapter = new EmailIntegrationAdapter({
      integrationId: "email-primary",
      secretResolver,
      secretReference,
      smtpUsername: "mailer@example.com",
      transport,
    });

    await expect(
      adapter.invoke({
        invocationId: "email-invocation-2",
        operation: "SEND_EMAIL",
        input: {
          to: ["victim@example.com\r\nBcc:attacker@example.com"],
          subject: "Hello",
          text: "Hello",
        },
      }),
    ).rejects.toMatchObject({
      kind: "INVALID_INPUT",
    });

    await expect(
      adapter.invoke({
        invocationId: "email-invocation-3",
        operation: "SEND_EMAIL",
        input: {
          to: ["user@example.com"],
          subject: "Hello",
          text: "",
        },
      }),
    ).rejects.toMatchObject({
      kind: "INVALID_INPUT",
    });

    expect(secretResolver.resolve).not.toHaveBeenCalled();
    expect(transport.send).not.toHaveBeenCalled();
  });

  it("rejects unsupported operations and invalid secret metadata", async () => {
    const transport: EmailTransport = {
      send: vi.fn(async () => ({ messageId: "unused" })),
    };
    const secretResolver = {
      resolve: vi.fn(async () => "smtp-secret"),
    };

    expect(
      () =>
        new EmailIntegrationAdapter({
          integrationId: "email-primary",
          secretResolver,
          secretReference: {
            ...secretReference,
            kind: "API_KEY",
          },
          smtpUsername: "mailer@example.com",
          transport,
        }),
    ).toThrow(RangeError);

    const adapter = new EmailIntegrationAdapter({
      integrationId: "email-primary",
      secretResolver,
      secretReference,
      smtpUsername: "mailer@example.com",
      transport,
    });

    await expect(
      adapter.invoke({
        invocationId: "email-invocation-4",
        operation: "DELETE_EMAIL",
        input: {},
      }),
    ).rejects.toMatchObject({
      kind: "INVALID_INPUT",
    });

    expect(secretResolver.resolve).not.toHaveBeenCalled();
  });

  it("maps unexpected transport failures without exposing credentials", async () => {
    const secretResolver = {
      resolve: vi.fn(async () => "super-secret-password"),
    };
    const transport: EmailTransport = {
      send: vi.fn(async () => {
        throw new Error("provider connection failed");
      }),
    };

    const adapter = new EmailIntegrationAdapter({
      integrationId: "email-primary",
      secretResolver,
      secretReference,
      smtpUsername: "mailer@example.com",
      transport,
    });

    await expect(
      adapter.invoke({
        invocationId: "email-invocation-5",
        operation: "SEND_EMAIL",
        input: {
          to: ["user@example.com"],
          subject: "Hello",
          text: "Hello",
        },
      }),
    ).rejects.toMatchObject({
      kind: "TRANSPORT_ERROR",
      message: "Email transport failed.",
    });
  });

  it("declares the governed non-idempotent communication capability", () => {
    const adapter = new EmailIntegrationAdapter({
      integrationId: "email-primary",
      secretResolver: {
        resolve: vi.fn(async () => "smtp-secret"),
      },
      secretReference,
      smtpUsername: "mailer@example.com",
      transport: {
        send: vi.fn(async () => ({ messageId: "unused" })),
      },
    });

    expect(adapter.kind).toBe("EMAIL");
    expect(adapter.actionKinds).toEqual(["EXTERNAL_COMMUNICATION"]);
    expect(adapter.supportedOperations).toEqual(["SEND_EMAIL"]);
    expect(adapter.sideEffectClass).toBe("NON_IDEMPOTENT");
  });
});
