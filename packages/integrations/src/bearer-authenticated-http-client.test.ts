import type { SecretReference } from "@polyon/contracts";
import { describe, expect, it, vi } from "vitest";

import {
  BearerAuthenticatedHttpClient,
} from "./bearer-authenticated-http-client";
import { BoundedHttpClient } from "./bounded-http-client";

const reference: SecretReference = {
  id: "google.primary",
  kind: "OAUTH_ACCESS_TOKEN",
  provider: "google",
};

describe("BearerAuthenticatedHttpClient", () => {
  it("resolves the secret and injects a bearer authorization header", async () => {
    const request = vi.fn(async (
      _input: {
        readonly url: string;
        readonly method?: "GET" | "HEAD";
        readonly headers?: Readonly<Record<string, string>>;
        readonly signal?: AbortSignal;
      },
      _options?: {
        readonly timeoutMs?: number;
        readonly maxResponseBytes?: number;
      },
    ) => ({
      url: "https://www.googleapis.com/drive/v3/files",
      status: 200,
      statusText: "OK",
      headers: {},
      body: new Uint8Array(),
    }));
    const client = {
      request,
    } as unknown as BoundedHttpClient;

    const resolver = {
      resolve: vi.fn(async () => "secret-token"),
    };

    const authenticated = new BearerAuthenticatedHttpClient({
      client,
      secretResolver: resolver,
      secretReference: reference,
    });

    await authenticated.request({
      url: "https://www.googleapis.com/drive/v3/files",
    });

    expect(resolver.resolve).toHaveBeenCalledWith(reference);
    expect(request).toHaveBeenCalledWith(
      {
        url: "https://www.googleapis.com/drive/v3/files",
        headers: {
          Authorization: "Bearer secret-token",
        },
      },
      undefined,
    );
  });

  it("rejects attempts to override the authorization header", async () => {
    const request = vi.fn();
    const authenticated = new BearerAuthenticatedHttpClient({
      client: {
        request,
      } as unknown as BoundedHttpClient,
      secretResolver: {
        resolve: vi.fn(async () => "secret-token"),
      },
      secretReference: reference,
    });

    await expect(
      authenticated.request({
        url: "https://www.googleapis.com/drive/v3/files",
        headers: {
          authorization: "Bearer attacker-token",
        },
      }),
    ).rejects.toThrow(/Authorization header/);

    expect(request).not.toHaveBeenCalled();
  });

  it("does not expose the resolved secret through the transport contract", async () => {
    const request = vi.fn(async () => ({
      url: "https://www.googleapis.com/drive/v3/files",
      status: 200,
      statusText: "OK",
      headers: {},
      body: new Uint8Array(),
    }));
    const secret = "secret-token";
    const authenticated = new BearerAuthenticatedHttpClient({
      client: {
        request,
      } as unknown as BoundedHttpClient,
      secretResolver: {
        resolve: vi.fn(async () => secret),
      },
      secretReference: reference,
    });

    await authenticated.request({
      url: "https://www.googleapis.com/drive/v3/files",
    });

    const called = request.mock.calls[0];
    expect(called).toBeDefined();
    if (called === undefined) {
      throw new Error("Expected bearer-authenticated HTTP request.");
    }
    const calledInput = called[0] as {
      readonly headers?: Readonly<Record<string, string>>;
    };
    expect(calledInput.headers?.Authorization).toBe("Bearer " + secret);
  });
});
