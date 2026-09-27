import { describe, expect, it, vi, afterEach } from "vitest";

import {
  BoundedHttpClient,
  BoundedHttpClientError,
} from "./bounded-http-client";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function response(body: string, init: ResponseInit = {}): Response {
  return new Response(body, {
    status: init.status ?? 200,
    statusText: init.statusText ?? "OK",
    headers: init.headers,
  });
}

describe("BoundedHttpClient", () => {
  it("allows only configured HTTPS hosts and returns a bounded response", async () => {
    const fetchMock = vi.fn(async () =>
      response("POLYON", {
        headers: {
          "content-type": "text/plain",
          etag: "v1",
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = new BoundedHttpClient({
      allowedHosts: ["api.example.com"],
      defaultMaxResponseBytes: 64,
    });

    const result = await client.request({
      url: "https://api.example.com/v1/status",
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(result.status).toBe(200);
    expect(new TextDecoder().decode(result.body)).toBe("POLYON");
    expect(result.headers).toEqual({
      "content-type": "text/plain",
      etag: "v1",
    });
  });

  it("rejects non-allowlisted hosts, insecure URLs, and embedded credentials", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const client = new BoundedHttpClient({
      allowedHosts: ["api.example.com"],
    });

    await expect(
      client.request({ url: "https://evil.example.com/data" }),
    ).rejects.toMatchObject({ kind: "HOST_NOT_ALLOWED" });

    await expect(
      client.request({ url: "http://api.example.com/data" }),
    ).rejects.toMatchObject({ kind: "INSECURE_URL" });

    await expect(
      client.request({ url: "https://user:password@api.example.com/data" }),
    ).rejects.toMatchObject({ kind: "INVALID_URL" });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("permits configured HTTP for local development only", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => response("ok")));

    const client = new BoundedHttpClient({
      allowedHosts: ["127.0.0.1"],
      allowInsecureHttp: true,
    });

    const result = await client.request({
      url: "http://127.0.0.1:8080/status",
    });

    expect(new TextDecoder().decode(result.body)).toBe("ok");
  });

  it("allows only GET and HEAD", async () => {
    const fetchMock = vi.fn(async () => response("ok"));
    vi.stubGlobal("fetch", fetchMock);

    const client = new BoundedHttpClient({
      allowedHosts: ["api.example.com"],
    });

    await expect(
      client.request({
        url: "https://api.example.com/data",
        method: "POST" as never,
      }),
    ).rejects.toMatchObject({ kind: "METHOD_NOT_ALLOWED" });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects content-length values above the response limit", async () => {
    const fetchMock = vi.fn(async () =>
      response("ignored", {
        headers: {
          "content-length": "1000",
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = new BoundedHttpClient({
      allowedHosts: ["api.example.com"],
      maxResponseBytes: 32,
      defaultMaxResponseBytes: 32,
    });

    await expect(
      client.request({ url: "https://api.example.com/data" }),
    ).rejects.toMatchObject({
      kind: "RESPONSE_TOO_LARGE",
    });
  });

  it("stops reading streamed responses after the configured byte limit", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode("123456"));
            controller.enqueue(new TextEncoder().encode("789012"));
            controller.close();
          },
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = new BoundedHttpClient({
      allowedHosts: ["api.example.com"],
      maxResponseBytes: 10,
      defaultMaxResponseBytes: 10,
    });

    await expect(
      client.request({ url: "https://api.example.com/data" }),
    ).rejects.toMatchObject({
      kind: "RESPONSE_TOO_LARGE",
    });
  });

  it("rejects request and response limits above configured maximums", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => response("ok")));

    const client = new BoundedHttpClient({
      allowedHosts: ["api.example.com"],
      defaultTimeoutMs: 1000,
      maxTimeoutMs: 1000,
      defaultMaxResponseBytes: 32,
      maxResponseBytes: 32,
    });

    await expect(
      client.request(
        { url: "https://api.example.com/data" },
        { timeoutMs: 1001 },
      ),
    ).rejects.toMatchObject({ kind: "INVALID_TIMEOUT" });

    await expect(
      client.request(
        { url: "https://api.example.com/data" },
        { maxResponseBytes: 33 },
      ),
    ).rejects.toMatchObject({ kind: "RESPONSE_TOO_LARGE" });
  });

  it("maps aborts to a timeout error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_input: unknown, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => {
              reject(new DOMException("Aborted", "AbortError"));
            });
          }),
      ),
    );

    const client = new BoundedHttpClient({
      allowedHosts: ["api.example.com"],
      defaultTimeoutMs: 10,
      maxTimeoutMs: 20,
    });

    const error = await client
      .request({ url: "https://api.example.com/data" })
      .catch((value: unknown) => value);

    expect(error).toBeInstanceOf(BoundedHttpClientError);
    expect(error).toMatchObject({ kind: "TIMEOUT" });
  });
});
