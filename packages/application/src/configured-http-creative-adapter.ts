import { BoundedHttpClient } from "@polyon/integrations";

import type { CreativeAdapter, CreativeJobRequest } from "./creative-job-service";

interface CreativeProviderResponse {
  readonly artifact: {
    readonly kind: CreativeJobRequest["outputKind"];
    readonly name: string;
    readonly status: "AVAILABLE" | "CREATING";
    readonly location: string;
    readonly mimeType?: string;
  };
}

export interface ConfiguredHttpCreativeAdapterOptions {
  readonly endpointByOperation: Readonly<Partial<Record<CreativeJobRequest["operation"], string>>>;
  readonly http: BoundedHttpClient;
}

export class ConfiguredHttpCreativeAdapter implements CreativeAdapter {
  constructor(private readonly options: ConfiguredHttpCreativeAdapterOptions) {}

  async generate(
    request: CreativeJobRequest,
    signal?: AbortSignal,
  ): Promise<CreativeProviderResponse> {
    const endpoint = this.options.endpointByOperation[request.operation];
    if (endpoint === undefined || endpoint.trim() === "") {
      throw new Error(`No creative provider endpoint is configured for ${request.operation}.`);
    }

    const response = await this.options.http.request(
      {
        url: endpoint,
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          operation: request.operation,
          prompt: request.prompt,
          outputKind: request.outputKind,
          artifactId: request.artifactId,
        }),
        signal,
      },
      {
        maxRequestBytes: 32_768,
        maxResponseBytes: 128_000,
      },
    );

    if (response.status < 200 || response.status >= 300) {
      throw new Error(`Creative provider returned HTTP ${response.status}.`);
    }

    let payload: unknown;
    try {
      payload = JSON.parse(new TextDecoder().decode(response.body));
    } catch {
      throw new Error("Creative provider returned invalid JSON.");
    }

    return parseResponse(payload, request.outputKind);
  }
}

function parseResponse(
  value: unknown,
  expectedKind: CreativeJobRequest["outputKind"],
): CreativeProviderResponse {
  if (!isRecord(value) || !isRecord(value.artifact)) {
    throw new Error("Creative provider returned an invalid artifact envelope.");
  }

  const kind = value.artifact.kind;
  if (kind !== expectedKind) {
    throw new Error("Creative provider returned an unexpected artifact kind.");
  }

  const status = value.artifact.status;
  if (status !== "AVAILABLE" && status !== "CREATING") {
    throw new Error("Creative provider returned an invalid artifact status.");
  }

  const name = stringField(value.artifact.name, "name", 500);
  const location = stringField(value.artifact.location, "location", 4_000);
  const mimeType =
    value.artifact.mimeType === undefined
      ? undefined
      : stringField(value.artifact.mimeType, "mimeType", 200);

  return {
    artifact: {
      kind,
      name,
      status,
      location,
      ...(mimeType === undefined ? {} : { mimeType }),
    },
  };
}

function stringField(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Creative provider artifact ${field} must be a non-empty string.`);
  }
  if (Array.from(value).length > maxLength) {
    throw new Error(`Creative provider artifact ${field} exceeds its bound.`);
  }
  return value.trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
