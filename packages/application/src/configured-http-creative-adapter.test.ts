import { describe, expect, it, vi } from "vitest";

import { ConfiguredHttpCreativeAdapter } from "./configured-http-creative-adapter";

describe("ConfiguredHttpCreativeAdapter", () => {
  it("maps bounded provider responses into the creative adapter contract", async () => {
    const request = vi.fn(async () => ({
      url: "https://creative.example.com/image",
      status: 200,
      statusText: "OK",
      headers: { "content-type": "application/json" },
      body: new TextEncoder().encode(JSON.stringify({
        artifact: {
          kind: "IMAGE",
          name: "generated.png",
          status: "AVAILABLE",
          location: "https://cdn.example.com/generated.png",
          mimeType: "image/png",
        },
      })),
    }));

    const adapter = new ConfiguredHttpCreativeAdapter({
      endpointByOperation: { IMAGE: "https://creative.example.com/image" },
      http: { request } as never,
    });

    const result = await adapter.generate({
      id: "job-1",
      operation: "IMAGE",
      prompt: "generate",
      outputKind: "IMAGE",
      artifactId: "artifact-1",
      artifactName: "generated.png",
      location: "https://cdn.example.com/generated.png",
      createdAt: "2026-09-28T00:00:00.000Z",
    });

    expect(result.artifact).toEqual({
      kind: "IMAGE",
      name: "generated.png",
      status: "AVAILABLE",
      location: "https://cdn.example.com/generated.png",
      mimeType: "image/png",
    });
  });

  it("fails closed for malformed provider output", async () => {
    const adapter = new ConfiguredHttpCreativeAdapter({
      endpointByOperation: { AUDIO: "https://creative.example.com/audio" },
      http: {
        request: vi.fn(async () => ({
          url: "https://creative.example.com/audio",
          status: 200,
          statusText: "OK",
          headers: {},
          body: new TextEncoder().encode(JSON.stringify({
            artifact: { kind: "VIDEO", name: "bad", status: "AVAILABLE", location: "x" },
          })),
        })),
      } as never,
    });

    await expect(
      adapter.generate({
        id: "job-2",
        operation: "AUDIO",
        prompt: "generate",
        outputKind: "AUDIO",
        artifactId: "artifact-2",
        artifactName: "audio.wav",
        location: "local://audio.wav",
        createdAt: "2026-09-28T00:00:00.000Z",
      }),
    ).rejects.toThrow("unexpected artifact kind");
  });
});
