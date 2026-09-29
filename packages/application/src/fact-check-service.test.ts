import { describe, expect, it, vi } from "vitest";

import { InMemoryDomainStores } from "@polyon/storage";
import type { AgentGateway } from "@polyon/agents";

import { FactCheckService } from "./fact-check-service";

const now = "2026-09-29T12:00:00.000Z";

function gateway(response = "The supplied evidence supports the claim.") {
  return {
    invokeText: vi.fn(async () => ({
      agentId: "fact-checker",
      modelId: "model.fact",
      providerId: "provider.local",
      source: "PREFERRED" as const,
      output: {
        content: response,
      },
    })),
  } as unknown as AgentGateway;
}

describe("FactCheckService", () => {
  it("classifies claims from supporting and contradicting evidence", async () => {
    const stores = new InMemoryDomainStores();
    stores.sources.save({
      id: "source-1",
      kind: "API",
      title: "Authoritative source",
      locator: "https://example.com/api",
      retrievedAt: now,
    });
    stores.sources.save({
      id: "source-2",
      kind: "WEB",
      title: "Conflicting source",
      locator: "https://example.com/conflict",
      retrievedAt: now,
    });
    stores.evidence.save({
      id: "evidence-support",
      sourceId: "source-1",
      kind: "SUPPORTING",
      claim: "POLYON supports durable jobs",
      supportingContent: "The API documents durable jobs.",
      capturedAt: now,
    });
    stores.evidence.save({
      id: "evidence-conflict",
      sourceId: "source-2",
      kind: "CONTRADICTING",
      claim: "POLYON supports durable jobs",
      supportingContent: "A conflicting report disputes the claim.",
      capturedAt: now,
    });

    const service = new FactCheckService({
      agentGateway: gateway(),
      evidence: stores.evidence,
      sources: stores.sources,
      events: stores.events,
      unitOfWork: stores,
    });

    const result = await service.run({
      checkId: "check-1",
      agentId: "fact-checker",
      claims: [
        { id: "claim-1", text: "POLYON supports durable jobs" },
      ],
      requiredCapabilityIds: ["ai.chat", "ai.reasoning"],
      now,
    });

    expect(result.claims[0]?.status).toBe("UNRESOLVED");
    expect(result.claims[0]?.supportingEvidenceIds).toEqual(["evidence-support"]);
    expect(result.claims[0]?.contradictingEvidenceIds).toEqual(["evidence-conflict"]);
    expect(result.claims[0]?.evidenceQualityScore).toBeGreaterThan(0);
    expect(stores.events.get("FACT_CHECK_STARTED:check-1")?.kind).toBe("FACT_CHECK_STARTED");
    expect(stores.events.get("FACT_CHECK_COMPLETED:check-1")?.kind).toBe("FACT_CHECK_COMPLETED");
  });

  it("marks claims supported or contradicted when evidence is one-sided", async () => {
    const stores = new InMemoryDomainStores();
    stores.sources.save({
      id: "source-1",
      kind: "DATABASE",
      title: "Database",
      locator: "db://facts",
      retrievedAt: now,
    });
    stores.evidence.save({
      id: "support",
      sourceId: "source-1",
      kind: "SUPPORTING",
      claim: "The service is durable",
      supportingContent: "Durability is documented.",
      capturedAt: now,
    });

    const service = new FactCheckService({
      agentGateway: gateway("Assessment."),
      evidence: stores.evidence,
      sources: stores.sources,
      events: stores.events,
      unitOfWork: stores,
    });

    const supported = await service.run({
      checkId: "check-supported",
      agentId: "fact-checker",
      claims: [{ id: "claim", text: "The service is durable" }],
      requiredCapabilityIds: ["ai.chat"],
      now,
    });

    expect(supported.claims[0]?.status).toBe("SUPPORTED");

    stores.evidence.save({
      id: "conflict",
      sourceId: "source-1",
      kind: "CONTRADICTING",
      claim: "The service is fast",
      supportingContent: "The benchmark disputes the speed claim.",
      capturedAt: now,
    });

    const contradicted = await service.run({
      checkId: "check-contradicted",
      agentId: "fact-checker",
      claims: [{ id: "claim", text: "The service is fast" }],
      requiredCapabilityIds: ["ai.chat"],
      now,
    });

    expect(contradicted.claims[0]?.status).toBe("CONTRADICTED");
  });

  it("rejects unbounded or duplicate claims", async () => {
    const service = new FactCheckService({
      agentGateway: gateway(),
      evidence: new InMemoryDomainStores().evidence,
      sources: new InMemoryDomainStores().sources,
      events: new InMemoryDomainStores().events,
    });

    await expect(
      service.run({
        checkId: "check",
        agentId: "fact-checker",
        claims: [
          { id: "same", text: "one" },
          { id: "same", text: "two" },
        ],
        requiredCapabilityIds: [],
        now,
      }),
    ).rejects.toThrow("Duplicate fact check claim id");
  });
});
