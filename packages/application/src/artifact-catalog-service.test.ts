import type { Artifact } from "@polyon/contracts";
import { InMemoryDomainStores } from "@polyon/storage";
import { describe, expect, it } from "vitest";

import {
  ArtifactCatalogService,
  ArtifactCatalogServiceError,
} from "./artifact-catalog-service";

function artifact(overrides: Partial<Artifact> & Pick<Artifact, "id">): Artifact {
  return {
    id: overrides.id,
    kind: overrides.kind ?? "REPORT",
    name: overrides.name ?? overrides.id,
    location: overrides.location ?? "/artifacts/" + overrides.id,
    status: overrides.status ?? "AVAILABLE",
    createdAt: overrides.createdAt ?? "2026-09-27T01:00:00.000Z",
    updatedAt: overrides.updatedAt ?? "2026-09-27T01:00:00.000Z",
    ...(overrides.mimeType === undefined ? {} : { mimeType: overrides.mimeType }),
    ...(overrides.missionId === undefined ? {} : { missionId: overrides.missionId }),
    ...(overrides.taskId === undefined ? {} : { taskId: overrides.taskId }),
    ...(overrides.executionId === undefined
      ? {}
      : { executionId: overrides.executionId }),
  };
}

describe("ArtifactCatalogService", () => {
  it("finds an artifact and throws a domain error when absent", () => {
    const stores = new InMemoryDomainStores();
    stores.artifacts.save(artifact({ id: "artifact-1" }));

    const service = new ArtifactCatalogService({
      artifacts: stores.artifacts,
    });

    expect(service.find("artifact-1")).toMatchObject({
      id: "artifact-1",
    });
    expect(() => service.get("missing")).toThrow(ArtifactCatalogServiceError);
  });

  it("filters and sorts deterministically", () => {
    const stores = new InMemoryDomainStores();
    stores.artifacts.save(
      artifact({
        id: "artifact-2",
        missionId: "mission-1",
        kind: "DOCUMENT",
        createdAt: "2026-09-27T01:02:00.000Z",
      }),
    );
    stores.artifacts.save(
      artifact({
        id: "artifact-1",
        missionId: "mission-1",
        kind: "REPORT",
        createdAt: "2026-09-27T01:01:00.000Z",
      }),
    );
    stores.artifacts.save(
      artifact({
        id: "artifact-3",
        missionId: "mission-2",
        createdAt: "2026-09-27T01:03:00.000Z",
      }),
    );

    const service = new ArtifactCatalogService({
      artifacts: stores.artifacts,
    });

    expect(
      service.list({
        missionId: "mission-1",
      }).map((item) => item.id),
    ).toEqual(["artifact-1", "artifact-2"]);

    expect(
      service.list({
        kind: "DOCUMENT",
      }).map((item) => item.id),
    ).toEqual(["artifact-2"]);
  });
});
