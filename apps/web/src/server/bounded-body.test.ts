import { describe, expect, it } from "vitest";

import { readBoundedText } from "./bounded-body";

function streamingRequest(parts: readonly string[]): Request {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const part of parts) controller.enqueue(encoder.encode(part));
      controller.close();
    },
  });
  return new Request("http://localhost/api", {
    method: "POST",
    body,
    duplex: "half",
  } as RequestInit);
}

describe("readBoundedText", () => {
  it("returns the body when it fits the limit", async () => {
    expect(await readBoundedText(streamingRequest(['{"a":', "1}"]), 16)).toBe('{"a":1}');
  });

  it("rejects a declared content length above the limit without reading", async () => {
    const request = new Request("http://localhost/api", {
      method: "POST",
      body: "x".repeat(10),
      headers: { "content-length": "10" },
    });
    expect(await readBoundedText(request, 5)).toBeUndefined();
    expect(request.bodyUsed).toBe(false);
  });

  it("stops reading a streamed body once it exceeds the limit", async () => {
    expect(await readBoundedText(streamingRequest(["abc", "def", "ghi"]), 5)).toBeUndefined();
  });

  it("decodes multi-byte characters split across chunks", async () => {
    const bytes = new TextEncoder().encode("é");
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.slice(0, 1));
        controller.enqueue(bytes.slice(1));
        controller.close();
      },
    });
    const request = new Request("http://localhost/api", {
      method: "POST",
      body,
      duplex: "half",
    } as RequestInit);
    expect(await readBoundedText(request, 8)).toBe("é");
  });
});
