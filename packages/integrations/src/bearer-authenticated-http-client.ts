import type { SecretReference } from "@polyon/contracts";

import {
  BoundedHttpClient,
  type BoundedHttpRequest,
  type BoundedHttpResponse,
} from "./bounded-http-client";
import type { SecretResolver } from "./secret-resolver";

export interface BearerAuthenticatedHttpClientOptions {
  readonly client: BoundedHttpClient;
  readonly secretResolver: SecretResolver;
  readonly secretReference: SecretReference;
}

export class BearerAuthenticatedHttpClient {
  constructor(
    private readonly options: BearerAuthenticatedHttpClientOptions,
  ) {}

  async request(
    input: Omit<BoundedHttpRequest, "headers"> & {
      readonly headers?: Readonly<Record<string, string>>;
    },
    options?: {
      readonly timeoutMs?: number;
      readonly maxResponseBytes?: number;
    },
  ): Promise<BoundedHttpResponse> {
    const token = await this.options.secretResolver.resolve(
      this.options.secretReference,
    );
    const headers = input.headers ?? {};

    if (
      Object.keys(headers).some(
        (name) => name.toLowerCase() === "authorization",
      )
    ) {
      throw new Error(
        "Bearer authentication manages the Authorization header.",
      );
    }

    return this.options.client.request(
      {
        ...input,
        headers: {
          ...headers,
          Authorization: "Bearer " + token,
        },
      },
      options,
    );
  }
}
