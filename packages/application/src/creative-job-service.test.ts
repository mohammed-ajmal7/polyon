import { describe, expect, it, vi } from "vitest";

import { InMemoryDomainStores } from "@polyon/storage";

import { CreativeJobService } from "./creative-job-service";

describe("CreativeJobService", () => {
  it("delegates to an injected creative adapter and persists the resulting artifact", async () => {
    const stores = new InMemoryDomainStores();
    const adapter = {
      generate: vi.fn(async () => ({
        artifact: {
          kind: "IMAGE" as const,
          name: "image.png",
          status: "AVAILABLE" as const,
          location: "local://image.png",
          mimeType: "image/png",
        },
      })),
    };

    const service = new CreativeJobService(adapter, stores.artifacts, stores.events, stores);
    const artifact = await service.run({
      id: "job-1",
      operation: "IMAGE",
      prompt: "Generate an abstract test image.",
      outputKind: "IMAGE",
      artifactId: "artifact-creative-1",
      artifactName: "image.png",
      location: "local://image.png",
      mimeType: "image/png",
      createdAt: "2026-09-28T00:00:00.000Z",
    });

    expect(adapter.generate).toHaveBeenCalledTimes(1);
    expect(artifact.kind).toBe("IMAGE");
    expect(stores.artifacts.get("artifact-creative-1")).toEqual(artifact);
  });
});
