import { describe, expect, it, vi } from "vitest";

import { InMemoryToolAdapterRegistry, InMemoryToolRegistry } from "@polyon/tools";

import { registerCreativeTools } from "./creative-tools";

describe("creative model tool", () => {
  it("registers a bounded network tool and delegates to CreativeJobService", async () => {
    const tools = new InMemoryToolRegistry();
    const adapters = new InMemoryToolAdapterRegistry();
    const run = vi.fn(async () => ({
      id: "artifact-1",
      kind: "IMAGE" as const,
      name: "image.png",
      status: "AVAILABLE" as const,
      location: "https://example.com/image.png",
      createdAt: "2026-09-28T00:00:00.000Z",
      updatedAt: "2026-09-28T00:00:00.000Z",
    }));

    registerCreativeTools(tools, adapters, { run } as never);

    expect(tools.get("creative.generate")?.actionKinds).toEqual(["NETWORK", "WRITE"]);

    const adapter = adapters.get("creative.generate");
    const result = await adapter?.invoke({
      input: {
        id: "job-1",
        operation: "IMAGE",
        prompt: "make an image",
        outputKind: "IMAGE",
        artifactId: "artifact-1",
        artifactName: "image.png",
        location: "https://example.com/image.png",
      },
    });

    expect(run).toHaveBeenCalledTimes(1);
    expect(result?.output).toMatchObject({ id: "artifact-1" });
  });
});
