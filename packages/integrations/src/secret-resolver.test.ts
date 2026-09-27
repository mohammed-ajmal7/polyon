import type { SecretReference } from "@polyon/contracts";
import { describe, expect, it } from "vitest";

import {
  EnvironmentSecretResolver,
  SecretResolverError,
} from "./secret-resolver";

const reference: SecretReference = {
  id: "telegram.primary",
  kind: "OAUTH_ACCESS_TOKEN",
  provider: "telegram",
};

describe("EnvironmentSecretResolver", () => {
  it("resolves a configured reference without persisting or transforming the secret", async () => {
    const secret = "super-secret-value";
    const resolver = new EnvironmentSecretResolver({
      environment: {
        POLYON_TELEGRAM_TOKEN: secret,
      },
      references: {
        "telegram.primary": "POLYON_TELEGRAM_TOKEN",
      },
    });

    await expect(resolver.resolve(reference)).resolves.toBe(secret);
  });

  it("fails closed for unknown references and unavailable secrets", async () => {
    const resolver = new EnvironmentSecretResolver({
      environment: {},
      references: {
        "telegram.primary": "POLYON_TELEGRAM_TOKEN",
      },
    });

    await expect(
      resolver.resolve({
        ...reference,
        id: "missing",
      }),
    ).rejects.toMatchObject({
      kind: "REFERENCE_NOT_CONFIGURED",
    });

    await expect(resolver.resolve(reference)).rejects.toMatchObject({
      kind: "SECRET_NOT_AVAILABLE",
    });
  });

  it("does not include secret values in errors", async () => {
    const secret = "do-not-leak";
    const resolver = new EnvironmentSecretResolver({
      environment: {
        POLYON_TELEGRAM_TOKEN: secret,
      },
      references: {
        "telegram.primary": "POLYON_TELEGRAM_TOKEN",
      },
    });

    const error = await resolver
      .resolve({
        ...reference,
        id: "unknown",
      })
      .catch((value: unknown) => value);

    expect(error).toBeInstanceOf(SecretResolverError);
    expect(String(error)).not.toContain(secret);
  });

  it("rejects unsafe reference mappings at construction", () => {
    expect(
      () =>
        new EnvironmentSecretResolver({
          environment: {},
          references: {
            "../secret": "POLYON_SECRET",
          },
        }),
    ).toThrow(RangeError);

    expect(
      () =>
        new EnvironmentSecretResolver({
          environment: {},
          references: {
            "safe.reference": "INVALID-NAME",
          },
        }),
    ).toThrow(RangeError);
  });
});
