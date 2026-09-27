export interface BoundedHttpRequest {
  readonly url: string;
  readonly method?: "GET" | "HEAD";
  readonly headers?: Readonly<Record<string, string>>;
  readonly signal?: AbortSignal;
}

export interface BoundedHttpResponse {
  readonly url: string;
  readonly status: number;
  readonly statusText: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: Uint8Array;
}

export interface BoundedHttpClientOptions {
  readonly allowedHosts: readonly string[];
  readonly defaultTimeoutMs?: number;
  readonly maxTimeoutMs?: number;
  readonly defaultMaxResponseBytes?: number;
  readonly maxResponseBytes?: number;
  readonly allowInsecureHttp?: boolean;
}

export type BoundedHttpClientErrorKind =
  | "INVALID_URL"
  | "INSECURE_URL"
  | "HOST_NOT_ALLOWED"
  | "METHOD_NOT_ALLOWED"
  | "INVALID_TIMEOUT"
  | "TIMEOUT"
  | "RESPONSE_TOO_LARGE"
  | "NETWORK_ERROR";

export class BoundedHttpClientError extends Error {
  readonly kind: BoundedHttpClientErrorKind;

  constructor(kind: BoundedHttpClientErrorKind, message: string) {
    super(message);
    this.name = "BoundedHttpClientError";
    this.kind = kind;
  }
}

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_RESPONSE_BYTES = 1_048_576;

export class BoundedHttpClient {
  private readonly allowedHosts: ReadonlySet<string>;
  private readonly defaultTimeoutMs: number;
  private readonly maxTimeoutMs: number;
  private readonly defaultMaxResponseBytes: number;
  private readonly maxResponseBytes: number;
  private readonly allowInsecureHttp: boolean;

  constructor(options: BoundedHttpClientOptions) {
    if (options.allowedHosts.length === 0) {
      throw new RangeError("allowedHosts must contain at least one host.");
    }

    this.allowedHosts = new Set(
      options.allowedHosts.map((host) => normalizeHost(host)),
    );

    this.defaultTimeoutMs = options.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxTimeoutMs = options.maxTimeoutMs ?? this.defaultTimeoutMs;
    this.defaultMaxResponseBytes =
      options.defaultMaxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
    this.maxResponseBytes = options.maxResponseBytes ?? this.defaultMaxResponseBytes;
    this.allowInsecureHttp = options.allowInsecureHttp ?? false;

    assertPositiveLimit(this.defaultTimeoutMs, "defaultTimeoutMs");
    assertPositiveLimit(this.maxTimeoutMs, "maxTimeoutMs");

    if (this.maxTimeoutMs < this.defaultTimeoutMs) {
      throw new RangeError("maxTimeoutMs must be at least defaultTimeoutMs.");
    }

    assertPositiveLimit(this.defaultMaxResponseBytes, "defaultMaxResponseBytes");
    assertPositiveLimit(this.maxResponseBytes, "maxResponseBytes");

    if (this.maxResponseBytes < this.defaultMaxResponseBytes) {
      throw new RangeError(
        "maxResponseBytes must be at least defaultMaxResponseBytes.",
      );
    }
  }

  async request(input: BoundedHttpRequest, options?: {
    readonly timeoutMs?: number;
    readonly maxResponseBytes?: number;
  }): Promise<BoundedHttpResponse> {
    const url = parseUrl(input.url, this.allowInsecureHttp);

    if (!this.allowedHosts.has(url.hostname.toLowerCase())) {
      throw new BoundedHttpClientError(
        "HOST_NOT_ALLOWED",
        `HTTP host is not allowlisted: ${url.hostname}.`,
      );
    }

    const method = input.method ?? "GET";

    if (method !== "GET" && method !== "HEAD") {
      throw new BoundedHttpClientError(
        "METHOD_NOT_ALLOWED",
        `HTTP method is not allowed: ${method}.`,
      );
    }

    const timeoutMs = options?.timeoutMs ?? this.defaultTimeoutMs;
    assertPositiveLimit(timeoutMs, "timeoutMs");

    if (timeoutMs > this.maxTimeoutMs) {
      throw new BoundedHttpClientError(
        "INVALID_TIMEOUT",
        `HTTP timeout exceeds the configured maximum: ${timeoutMs}ms.`,
      );
    }

    const maxResponseBytes = options?.maxResponseBytes ?? this.defaultMaxResponseBytes;
    assertPositiveLimit(maxResponseBytes, "maxResponseBytes");

    if (maxResponseBytes > this.maxResponseBytes) {
      throw new BoundedHttpClientError(
        "RESPONSE_TOO_LARGE",
        `HTTP response limit exceeds the configured maximum: ${maxResponseBytes} bytes.`,
      );
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const externalSignal = input.signal;

    let removeExternalAbortListener: (() => void) | undefined;

    if (externalSignal !== undefined) {
      if (externalSignal.aborted) {
        controller.abort();
      } else {
        const onExternalAbort = () => controller.abort();
        externalSignal.addEventListener("abort", onExternalAbort, { once: true });
        removeExternalAbortListener = () =>
          externalSignal.removeEventListener("abort", onExternalAbort);
      }
    }

    try {
      const response = await fetch(url, {
        method,
        redirect: "error",
        headers: input.headers,
        signal: controller.signal,
      });

      const contentLength = response.headers.get("content-length");
      if (contentLength !== null) {
        const parsedLength = Number(contentLength);
        if (Number.isFinite(parsedLength) && parsedLength > maxResponseBytes) {
          throw new BoundedHttpClientError(
            "RESPONSE_TOO_LARGE",
            `HTTP response exceeds the ${maxResponseBytes}-byte limit.`,
          );
        }
      }

      const body = await readBoundedBody(
        response,
        maxResponseBytes,
      );

      return {
        url: response.url || url.toString(),
        status: response.status,
        statusText: response.statusText,
        headers: selectResponseHeaders(response.headers),
        body,
      };
    } catch (error) {
      if (error instanceof BoundedHttpClientError) {
        throw error;
      }

      if (error instanceof Error && error.name === "AbortError") {
        throw new BoundedHttpClientError(
          "TIMEOUT",
          `HTTP request exceeded the ${timeoutMs}ms timeout.`,
        );
      }

      throw new BoundedHttpClientError(
        "NETWORK_ERROR",
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      clearTimeout(timer);
      removeExternalAbortListener?.();
    }
  }
}

function parseUrl(value: string, allowInsecureHttp: boolean): URL {
  let url: URL;

  try {
    url = new URL(value);
  } catch {
    throw new BoundedHttpClientError(
      "INVALID_URL",
      `Invalid HTTP URL: ${value}.`,
    );
  }

  const secure = url.protocol === "https:";
  if (!secure && !(allowInsecureHttp && url.protocol === "http:")) {
    throw new BoundedHttpClientError(
      "INSECURE_URL",
      `Only HTTPS URLs are allowed: ${value}.`,
    );
  }

  if (url.username !== "" || url.password !== "") {
    throw new BoundedHttpClientError(
      "INVALID_URL",
      "HTTP URLs must not contain embedded credentials.",
    );
  }

  return url;
}

function normalizeHost(value: string): string {
  const host = value.trim().toLowerCase();
  if (host === "" || host.includes("/") || host.includes(":")) {
    throw new RangeError(`Invalid allowlisted host: ${value}.`);
  }
  return host;
}

function assertPositiveLimit(value: number, field: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new RangeError(`${field} must be a positive integer.`);
  }
}

async function readBoundedBody(
  response: Response,
  maxResponseBytes: number,
): Promise<Uint8Array> {
  if (response.body === null) {
    return new Uint8Array();
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    while (true) {
      const next = await reader.read();
      if (next.done) {
        break;
      }

      total += next.value.byteLength;

      if (total > maxResponseBytes) {
        await reader.cancel();
        throw new BoundedHttpClientError(
          "RESPONSE_TOO_LARGE",
          `HTTP response exceeds the ${maxResponseBytes}-byte limit.`,
        );
      }

      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }

  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return output;
}

function selectResponseHeaders(
  headers: Headers,
): Readonly<Record<string, string>> {
  const selected: Record<string, string> = {};

  for (const name of ["content-type", "etag", "last-modified", "retry-after"]) {
    const value = headers.get(name);
    if (value !== null) {
      selected[name] = value;
    }
  }

  return selected;
}
