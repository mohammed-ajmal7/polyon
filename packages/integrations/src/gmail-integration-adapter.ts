import type { SecretReference } from "@polyon/contracts";
import type { IntegrationAdapter, IntegrationInvocationRequest, IntegrationInvocationResult } from "./integration-adapter";
import { BoundedHttpClient } from "./bounded-http-client";
import { BearerAuthenticatedHttpClient } from "./bearer-authenticated-http-client";
import type { SecretResolver } from "./secret-resolver";

export type GmailOperation = "SEARCH_MESSAGES" | "GET_MESSAGE";
export interface GmailSearchInput { readonly query?: string; readonly maxResults?: number; readonly pageToken?: string; }
export interface GmailGetMessageInput { readonly messageId: string; }
export interface GmailMessageHeader { readonly name: string; readonly value: string; }
export interface GmailMessageSummary {
  readonly id: string; readonly threadId?: string; readonly labelIds?: readonly string[];
  readonly snippet?: string; readonly internalDate?: string; readonly headers?: readonly GmailMessageHeader[];
  readonly textBody?: string;
}
export interface GmailSearchOutput { readonly messages: readonly GmailMessageSummary[]; readonly nextPageToken?: string; readonly resultSizeEstimate?: number; }
export interface GmailGetMessageOutput { readonly message: GmailMessageSummary; }
export type GmailInvocationOutput = GmailSearchOutput | GmailGetMessageOutput;
export type GmailIntegrationAdapterErrorKind = "INVALID_INPUT" | "INVALID_RESPONSE" | "API_ERROR";
export class GmailIntegrationAdapterError extends Error {
  readonly kind: GmailIntegrationAdapterErrorKind;
  constructor(kind: GmailIntegrationAdapterErrorKind, message: string) { super(message); this.name = "GmailIntegrationAdapterError"; this.kind = kind; }
}
export interface GmailIntegrationAdapterOptions {
  readonly integrationId: string; readonly secretResolver: SecretResolver; readonly secretReference: SecretReference;
  readonly client?: BoundedHttpClient; readonly maxResponseBytes?: number; readonly defaultMaxResults?: number; readonly maxResults?: number;
}
const DEFAULT_MAX_RESULTS = 20;
const MAX_RESULTS = 100;
const MAX_QUERY_LENGTH = 2000;
const MAX_ID_LENGTH = 500;
const MAX_BODY_LENGTH = 100000;

export class GmailIntegrationAdapter implements IntegrationAdapter {
  readonly integrationId: string;
  readonly kind = "EMAIL" as const;
  readonly actionKinds = ["READ"] as const;
  readonly supportedOperations = ["SEARCH_MESSAGES", "GET_MESSAGE"] as const;
  readonly sideEffectClass = "READ_ONLY" as const;
  private readonly http: BearerAuthenticatedHttpClient;
  private readonly defaultMaxResults: number;
  private readonly maxResults: number;
  private readonly maxResponseBytes?: number;

  constructor(options: GmailIntegrationAdapterOptions) {
    if (options.integrationId.trim() === "") throw new RangeError("integrationId must not be empty.");
    if (options.secretReference.provider !== "google" || options.secretReference.kind !== "OAUTH_ACCESS_TOKEN") {
      throw new RangeError("Gmail integration requires a Google OAuth access-token reference.");
    }
    this.integrationId = options.integrationId;
    this.defaultMaxResults = options.defaultMaxResults ?? DEFAULT_MAX_RESULTS;
    this.maxResults = options.maxResults ?? MAX_RESULTS;
    this.maxResponseBytes = options.maxResponseBytes;
    if (!Number.isInteger(this.defaultMaxResults) || this.defaultMaxResults <= 0 ||
        !Number.isInteger(this.maxResults) || this.maxResults < this.defaultMaxResults || this.maxResults > MAX_RESULTS) {
      throw new RangeError("Gmail result limits must be positive and bounded.");
    }
    const client = options.client ?? new BoundedHttpClient({
      allowedHosts: ["gmail.googleapis.com"], allowedPorts: [443], defaultTimeoutMs: 15000, maxTimeoutMs: 30000,
      defaultMaxResponseBytes: options.maxResponseBytes ?? 1048576, maxResponseBytes: options.maxResponseBytes ?? 1048576,
    });
    this.http = new BearerAuthenticatedHttpClient({ client, secretResolver: options.secretResolver, secretReference: options.secretReference });
  }

  async invoke(request: IntegrationInvocationRequest<unknown>): Promise<IntegrationInvocationResult<GmailInvocationOutput>> {
    if (request.operation === "SEARCH_MESSAGES") return { output: await this.search(request.input) };
    if (request.operation === "GET_MESSAGE") return { output: await this.get(request.input) };
    throw new GmailIntegrationAdapterError("INVALID_INPUT", `Unsupported Gmail operation: ${request.operation}.`);
  }

  private async search(input: unknown): Promise<GmailSearchOutput> {
    const value = parseSearch(input, this.defaultMaxResults, this.maxResults);
    const params = new URLSearchParams({ maxResults: String(value.maxResults), includeSpamTrash: "false" });
    if (value.query !== undefined) params.set("q", value.query);
    if (value.pageToken !== undefined) params.set("pageToken", value.pageToken);
    const response = await this.request(`https://gmail.googleapis.com/gmail/v1/users/me/messages?${params.toString()}`);
    const root = parseJson(response, "messages.list");
    const messages = Array.isArray(root.messages) ? root.messages.map(parseReference) : [];
    return {
      messages,
      ...(typeof root.nextPageToken === "string" ? { nextPageToken: root.nextPageToken } : {}),
      ...(typeof root.resultSizeEstimate === "number" ? { resultSizeEstimate: root.resultSizeEstimate } : {}),
    };
  }

  private async get(input: unknown): Promise<GmailGetMessageOutput> {
    const value = parseGet(input);
    const response = await this.request(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(value.messageId)}?format=full`);
    return { message: parseFull(parseJson(response, "messages.get")) };
  }

  private request(url: string) {
    return this.http.request({ url, headers: { Accept: "application/json" } },
      this.maxResponseBytes === undefined ? undefined : { maxResponseBytes: this.maxResponseBytes });
  }
}

function parseSearch(input: unknown, fallback: number, max: number): GmailSearchInput & { readonly maxResults: number } {
  if (input === null || typeof input !== "object") throw new GmailIntegrationAdapterError("INVALID_INPUT", "SEARCH_MESSAGES requires an object input.");
  const value = input as Record<string, unknown>;
  const limit = value.maxResults === undefined ? fallback : value.maxResults;
  if (!Number.isInteger(limit) || (limit as number) <= 0 || (limit as number) > max) throw new GmailIntegrationAdapterError("INVALID_INPUT", `Gmail maxResults must be between 1 and ${max}.`);
  if (value.query !== undefined && (typeof value.query !== "string" || value.query.length > MAX_QUERY_LENGTH)) throw new GmailIntegrationAdapterError("INVALID_INPUT", "Gmail query is invalid or too long.");
  if (value.pageToken !== undefined && (typeof value.pageToken !== "string" || value.pageToken.length > 5000)) throw new GmailIntegrationAdapterError("INVALID_INPUT", "Gmail pageToken is invalid or too long.");
  return { maxResults: limit as number, ...(value.query === undefined ? {} : { query: value.query as string }), ...(value.pageToken === undefined ? {} : { pageToken: value.pageToken as string }) };
}
function parseGet(input: unknown): GmailGetMessageInput {
  if (input === null || typeof input !== "object" || typeof (input as Record<string, unknown>).messageId !== "string") throw new GmailIntegrationAdapterError("INVALID_INPUT", "GET_MESSAGE requires a messageId string.");
  const messageId = (input as Record<string, unknown>).messageId as string;
  if (messageId.trim() === "" || messageId.length > MAX_ID_LENGTH) throw new GmailIntegrationAdapterError("INVALID_INPUT", "Gmail messageId is invalid.");
  return { messageId };
}
function parseJson(response: { readonly body: Uint8Array; readonly status: number }, operation: string): Record<string, unknown> {
  if (response.status < 200 || response.status >= 300) throw new GmailIntegrationAdapterError("API_ERROR", `Gmail ${operation} returned HTTP ${response.status}.`);
  try {
    const value: unknown = JSON.parse(new TextDecoder().decode(response.body));
    if (value === null || typeof value !== "object") throw new Error();
    return value as Record<string, unknown>;
  } catch { throw new GmailIntegrationAdapterError("INVALID_RESPONSE", "Gmail returned invalid JSON."); }
}
function parseReference(value: unknown): GmailMessageSummary {
  if (value === null || typeof value !== "object" || typeof (value as Record<string, unknown>).id !== "string") throw new GmailIntegrationAdapterError("INVALID_RESPONSE", "Gmail message reference is missing an id.");
  const item = value as Record<string, unknown>;
  return { id: item.id as string, ...(typeof item.threadId === "string" ? { threadId: item.threadId } : {}) };
}
function parseFull(value: Record<string, unknown>): GmailMessageSummary {
  if (typeof value.id !== "string") throw new GmailIntegrationAdapterError("INVALID_RESPONSE", "Gmail message is missing an id.");
  const headers = extractHeaders(value.payload);
  const textBody = extractText(value.payload);
  return {
    id: value.id,
    ...(typeof value.threadId === "string" ? { threadId: value.threadId } : {}),
    ...(Array.isArray(value.labelIds) ? { labelIds: value.labelIds.filter((x): x is string => typeof x === "string") } : {}),
    ...(typeof value.snippet === "string" ? { snippet: value.snippet } : {}),
    ...(typeof value.internalDate === "string" ? { internalDate: value.internalDate } : {}),
    ...(headers.length === 0 ? {} : { headers }),
    ...(textBody === undefined ? {} : { textBody }),
  };
}
function extractHeaders(payload: unknown): readonly GmailMessageHeader[] {
  if (payload === null || typeof payload !== "object") return [];
  const headers = (payload as Record<string, unknown>).headers;
  if (!Array.isArray(headers)) return [];
  return headers.flatMap((x) => {
    if (x === null || typeof x !== "object") return [];
    const h = x as Record<string, unknown>;
    return typeof h.name === "string" && typeof h.value === "string" ? [{ name: h.name, value: h.value }] : [];
  });
}
function extractText(payload: unknown): string | undefined {
  const parts = collectText(payload);
  if (parts.length === 0) return undefined;
  const text = parts.join("\n\n");
  return text.length > MAX_BODY_LENGTH ? Array.from(text).slice(0, MAX_BODY_LENGTH).join("") : text;
}
function collectText(payload: unknown): string[] {
  if (payload === null || typeof payload !== "object") return [];
  const value = payload as Record<string, unknown>;
  if (value.mimeType === "text/plain" && value.body !== null && typeof value.body === "object") {
    const data = (value.body as Record<string, unknown>).data;
    if (typeof data === "string") {
      try { return [Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8")]; } catch { return []; }
    }
  }
  return Array.isArray(value.parts) ? value.parts.flatMap(collectText) : [];
}
