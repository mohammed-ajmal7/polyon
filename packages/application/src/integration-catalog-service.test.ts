import { InMemoryIntegrationAdapterRegistry, type IntegrationAdapter } from "@polyon/integrations";
import { describe, expect, it } from "vitest";

import {
  IntegrationCatalogService,
  IntegrationCatalogServiceError,
} from "./integration-catalog-service";

const google: IntegrationAdapter = {
  integrationId: "google-drive-primary",
  kind: "GOOGLE_DRIVE",
  actionKinds: ["READ"],
  supportedOperations: ["LIST_FILES", "GET_METADATA"],
  async invoke() {
    return { output: {} };
  },
};

const email: IntegrationAdapter = {
  integrationId: "email-primary",
  kind: "EMAIL",
  actionKinds: ["EXTERNAL_COMMUNICATION"],
  supportedOperations: ["send"],
  async invoke() {
    return { output: {} };
  },
};

describe("IntegrationCatalogService", () => {
  it("returns safe integration metadata without adapter internals", () => {
    const registry = new InMemoryIntegrationAdapterRegistry();
    registry.register(email);
    registry.register(google);

    const service = new IntegrationCatalogService(registry);

    expect(service.list()).toEqual([
      {
        integrationId: "email-primary",
        kind: "EMAIL",
        actionKinds: ["EXTERNAL_COMMUNICATION"],
        supportedOperations: ["send"],
        sideEffectClass: "NON_IDEMPOTENT",
      },
      {
        integrationId: "google-drive-primary",
        kind: "GOOGLE_DRIVE",
        actionKinds: ["READ"],
        supportedOperations: ["LIST_FILES", "GET_METADATA"],
      sideEffectClass: "READ_ONLY",
        sideEffectClass: "READ_ONLY",
      },
    ]);
    expect(service.find("google-drive-primary")).toMatchObject({
      integrationId: "google-drive-primary",
      supportedOperations: ["LIST_FILES", "GET_METADATA"],
    });
  });

  it("filters by integration kind and action", () => {
    const registry = new InMemoryIntegrationAdapterRegistry();
    registry.register(email);
    registry.register(google);

    const service = new IntegrationCatalogService(registry);

    expect(service.list({ kind: "GOOGLE_DRIVE" }).map((item) => item.integrationId)).toEqual([
      "google-drive-primary",
    ]);
    expect(
      service.list({ action: "EXTERNAL_COMMUNICATION" }).map((item) => item.integrationId),
    ).toEqual(["email-primary"]);
  });

  it("raises a domain error for an unknown integration", () => {
    const service = new IntegrationCatalogService(new InMemoryIntegrationAdapterRegistry());

    expect(() => service.get("missing")).toThrow(IntegrationCatalogServiceError);
  });
});
