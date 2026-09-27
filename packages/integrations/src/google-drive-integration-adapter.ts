import type { SecretReference } from "@polyon/contracts";

import type {
  IntegrationAdapter,
  IntegrationInvocationRequest,
  IntegrationInvocationResult,
} from "./integration-adapter";
import { BoundedHttpClient } from "./bounded-http-client";
import { BearerAuthenticatedHttpClient } from "./bearer-authenticated-http-client";
import type { SecretResolver } from "./secret-resolver";

export type GoogleDriveOperation = "LIST_FILES" | "GET_METADATA";

export interface GoogleDriveListInput {
  readonly q?: string;
  readonly pageSize?: number;
  readonly pageToken?: string;
}

export interface GoogleDriveGetMetadataInput {
  readonly fileId: string;
}

export type GoogleDriveInvocationInput =
  | GoogleDriveListInput
  | GoogleDriveGetMetadataInput;

export interface GoogleDriveFileMetadata {
  readonly id: string;
  readonly name?: string;
  readonly mimeType?: string;
  readonly modifiedTime?: string;
  readonly size?: string;
  readonly starred?: boolean;
  readonly trashed?: boolean;
  readonly parents?: readonly string[];
  readonly capabilities?: {
    readonly canDownload?: boolean;
  };
  readonly webViewLink?: string;
}

export interface GoogleDriveListOutput {
  readonly files: readonly GoogleDriveFileMetadata[];
  readonly nextPageToken?: string;
}

export interface GoogleDriveMetadataOutput {
  readonly file: GoogleDriveFileMetadata;
}

export type GoogleDriveInvocationOutput =
  | GoogleDriveListOutput
  | GoogleDriveMetadataOutput;

export type GoogleDriveIntegrationAdapterErrorKind =
  | "INVALID_INPUT"
  | "INVALID_RESPONSE"
  | "API_ERROR";

export class GoogleDriveIntegrationAdapterError extends Error {
  readonly kind: GoogleDriveIntegrationAdapterErrorKind;

  constructor(kind: GoogleDriveIntegrationAdapterErrorKind, message: string) {
    super(message);
    this.name = "GoogleDriveIntegrationAdapterError";
    this.kind = kind;
  }
}

export interface GoogleDriveIntegrationAdapterOptions {
  readonly integrationId: string;
  readonly secretResolver: SecretResolver;
  readonly secretReference: SecretReference;
  readonly client?: BoundedHttpClient;
  readonly maxResponseBytes?: number;
  readonly defaultPageSize?: number;
  readonly maxPageSize?: number;
}

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;

const FILE_FIELDS =
  "files(id,name,mimeType,modifiedTime,size,starred,trashed,parents,capabilities(canDownload),webViewLink),nextPageToken";

export class GoogleDriveIntegrationAdapter
  implements IntegrationAdapter
{
  readonly integrationId: string;
  readonly kind = "GOOGLE_DRIVE" as const;
  readonly actionKinds = ["READ"] as const;
  readonly supportedOperations = ["LIST_FILES", "GET_METADATA"] as const;

  private readonly http: BearerAuthenticatedHttpClient;
  private readonly defaultPageSize: number;
  private readonly maxPageSize: number;
  private readonly maxResponseBytes?: number;

  constructor(options: GoogleDriveIntegrationAdapterOptions) {
    if (options.integrationId.trim() === "") {
      throw new RangeError("integrationId must not be empty.");
    }

    if (options.secretReference.provider !== "google") {
      throw new RangeError(
        "Google Drive integration requires a Google secret reference.",
      );
    }

    if (options.secretReference.kind !== "OAUTH_ACCESS_TOKEN") {
      throw new RangeError(
        "Google Drive integration requires an OAuth access-token reference.",
      );
    }

    this.integrationId = options.integrationId;
    this.defaultPageSize = options.defaultPageSize ?? DEFAULT_PAGE_SIZE;
    this.maxPageSize = options.maxPageSize ?? MAX_PAGE_SIZE;
    this.maxResponseBytes = options.maxResponseBytes;

    if (
      !Number.isInteger(this.defaultPageSize) ||
      this.defaultPageSize <= 0 ||
      !Number.isInteger(this.maxPageSize) ||
      this.maxPageSize < this.defaultPageSize ||
      this.maxPageSize > 1000
    ) {
      throw new RangeError(
        "Google Drive page-size limits must be positive and bounded.",
      );
    }

    const client =
      options.client ??
      new BoundedHttpClient({
        allowedHosts: ["www.googleapis.com"],
        allowedPorts: [443],
        defaultTimeoutMs: 15_000,
        maxTimeoutMs: 30_000,
        defaultMaxResponseBytes:
          options.maxResponseBytes ?? 1_048_576,
        maxResponseBytes:
          options.maxResponseBytes ?? 1_048_576,
      });

    this.http = new BearerAuthenticatedHttpClient({
      client,
      secretResolver: options.secretResolver,
      secretReference: options.secretReference,
    });
  }

  async invoke(
    request: IntegrationInvocationRequest<unknown>,
  ): Promise<IntegrationInvocationResult<GoogleDriveInvocationOutput>> {
    if (request.operation === "LIST_FILES") {
      return {
        output: await this.listFiles(request.input),
      };
    }

    if (request.operation === "GET_METADATA") {
      return {
        output: await this.getMetadata(request.input),
      };
    }

    throw new GoogleDriveIntegrationAdapterError(
      "INVALID_INPUT",
      `Unsupported Google Drive operation: ${request.operation}.`,
    );
  }

  private async listFiles(
    input: unknown,
  ): Promise<GoogleDriveListOutput> {
    const listInput = parseListInput(
      input,
      this.defaultPageSize,
      this.maxPageSize,
    );
    const query = new URLSearchParams({
      pageSize: String(listInput.pageSize),
      fields: FILE_FIELDS,
      orderBy: "modifiedTime desc",
    });

    if (listInput.q !== undefined) {
      query.set("q", listInput.q);
    }

    if (listInput.pageToken !== undefined) {
      query.set("pageToken", listInput.pageToken);
    }

    const response = await this.http.request({
      url: `https://www.googleapis.com/drive/v3/files?${query.toString()}`,
      headers: {
        Accept: "application/json",
      },
    }, this.maxResponseBytes === undefined
      ? undefined
      : { maxResponseBytes: this.maxResponseBytes });

    return parseListResponse(response);
  }

  private async getMetadata(
    input: unknown,
  ): Promise<GoogleDriveMetadataOutput> {
    const value = parseGetMetadataInput(input);
    const query = new URLSearchParams({
      fields: FILE_FIELDS.replace(",nextPageToken", ""),
      supportsAllDrives: "true",
    });

    const response = await this.http.request({
      url: `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(value.fileId)}?${query.toString()}`,
      headers: {
        Accept: "application/json",
      },
    }, this.maxResponseBytes === undefined
      ? undefined
      : { maxResponseBytes: this.maxResponseBytes });

    return await parseFileMetadata(response);
  }
}

function parseListInput(
  input: unknown,
  defaultPageSize: number,
  maxPageSize: number,
): GoogleDriveListInput & { readonly pageSize: number } {
  if (input === null || typeof input !== "object") {
    throw new GoogleDriveIntegrationAdapterError(
      "INVALID_INPUT",
      "LIST_FILES requires an object input.",
    );
  }

  const value = input as Record<string, unknown>;
  const pageSize =
    value.pageSize === undefined ? defaultPageSize : value.pageSize;

  if (
    !Number.isInteger(pageSize) ||
    (pageSize as number) <= 0 ||
    (pageSize as number) > maxPageSize
  ) {
    throw new GoogleDriveIntegrationAdapterError(
      "INVALID_INPUT",
      `Google Drive pageSize must be between 1 and ${maxPageSize}.`,
    );
  }

  if (
    value.q !== undefined &&
    (typeof value.q !== "string" || value.q.length > 2000)
  ) {
    throw new GoogleDriveIntegrationAdapterError(
      "INVALID_INPUT",
      "Google Drive q must be a string of at most 2000 characters.",
    );
  }

  if (
    value.pageToken !== undefined &&
    (typeof value.pageToken !== "string" || value.pageToken.length > 5000)
  ) {
    throw new GoogleDriveIntegrationAdapterError(
      "INVALID_INPUT",
      "Google Drive pageToken must be a string of at most 5000 characters.",
    );
  }

  return {
    pageSize: pageSize as number,
    ...(value.q === undefined ? {} : { q: value.q as string }),
    ...(value.pageToken === undefined ? {} : { pageToken: value.pageToken as string }),
  };
}

function parseGetMetadataInput(input: unknown): GoogleDriveGetMetadataInput {
  if (
    input === null ||
    typeof input !== "object" ||
    typeof (input as Record<string, unknown>).fileId !== "string"
  ) {
    throw new GoogleDriveIntegrationAdapterError(
      "INVALID_INPUT",
      "GET_METADATA requires a fileId string.",
    );
  }

  const fileId = (input as Record<string, unknown>).fileId as string;

  if (fileId.trim() === "" || fileId.length > 500) {
    throw new GoogleDriveIntegrationAdapterError(
      "INVALID_INPUT",
      "Google Drive fileId must be non-empty and at most 500 characters.",
    );
  }

  return { fileId };
}

async function parseJsonBody(
  body: Uint8Array,
): Promise<Record<string, unknown>> {
  const text = new TextDecoder().decode(body);

  try {
    const value: unknown = JSON.parse(text);
    if (value === null || typeof value !== "object") {
      throw new Error("response root is not an object");
    }
    return value as Record<string, unknown>;
  } catch {
    throw new GoogleDriveIntegrationAdapterError(
      "INVALID_RESPONSE",
      "Google Drive returned an invalid JSON response.",
    );
  }
}

function parseListResponseSync(
  value: Record<string, unknown>,
): GoogleDriveListOutput {
  const filesValue = value.files;
  if (!Array.isArray(filesValue)) {
    throw new GoogleDriveIntegrationAdapterError(
      "INVALID_RESPONSE",
      "Google Drive list response is missing files.",
    );
  }

  const files = filesValue.map(parseFileMetadataValue);
  const nextPageToken =
    typeof value.nextPageToken === "string" ? value.nextPageToken : undefined;

  return {
    files,
    ...(nextPageToken === undefined ? {} : { nextPageToken }),
  };
}

async function parseListResponse(
  response: { readonly body: Uint8Array; readonly status: number },
): Promise<GoogleDriveListOutput> {
  if (response.status < 200 || response.status >= 300) {
    throw new GoogleDriveIntegrationAdapterError(
      "API_ERROR",
      `Google Drive files.list returned HTTP ${response.status}.`,
    );
  }

  return parseListResponseSync(await parseJsonBody(response.body));
}

async function parseFileMetadata(
  response: { readonly body: Uint8Array; readonly status: number },
): Promise<{ file: GoogleDriveFileMetadata }> {
  if (response.status < 200 || response.status >= 300) {
    throw new GoogleDriveIntegrationAdapterError(
      "API_ERROR",
      `Google Drive files.get returned HTTP ${response.status}.`,
    );
  }

  const value = await parseJsonBody(response.body);
  return {
    file: parseFileMetadataValue(value),
  };
}

function parseFileMetadataValue(value: unknown): GoogleDriveFileMetadata {
  if (
    value === null ||
    typeof value !== "object" ||
    typeof (value as Record<string, unknown>).id !== "string"
  ) {
    throw new GoogleDriveIntegrationAdapterError(
      "INVALID_RESPONSE",
      "Google Drive file metadata is missing an id.",
    );
  }

  const item = value as Record<string, unknown>;
  return {
    id: item.id as string,
    ...(typeof item.name === "string" ? { name: item.name } : {}),
    ...(typeof item.mimeType === "string" ? { mimeType: item.mimeType } : {}),
    ...(typeof item.modifiedTime === "string"
      ? { modifiedTime: item.modifiedTime }
      : {}),
    ...(typeof item.size === "string" ? { size: item.size } : {}),
    ...(typeof item.starred === "boolean" ? { starred: item.starred } : {}),
    ...(typeof item.trashed === "boolean" ? { trashed: item.trashed } : {}),
    ...(Array.isArray(item.parents)
      ? {
          parents: item.parents.filter(
            (parent): parent is string => typeof parent === "string",
          ),
        }
      : {}),
    ...(item.capabilities !== null &&
    typeof item.capabilities === "object" &&
    typeof (item.capabilities as Record<string, unknown>).canDownload === "boolean"
      ? {
          capabilities: {
            canDownload: (item.capabilities as Record<string, unknown>)
              .canDownload as boolean,
          },
        }
      : {}),
    ...(typeof item.webViewLink === "string"
      ? { webViewLink: item.webViewLink }
      : {}),
  };
}
