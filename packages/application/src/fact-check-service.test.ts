import { describe, expect, it, vi } from "vitest";

import type { Agent, Evidence, Source, TextModelRequest } from "@polyon/contracts";
import { InMemoryAgentRegistry } from "@polyon/agents";
import { InMemoryDomainStores } from "@polyon/storage";

import { FactCheckService } from "./fact-check-service";

const now = "2026-09-29T09:00:00.000Z";

function agent(): Agent {
  return {
    id: "fact-checker",
    name: "Fact Checker",
    role: "Fact Checker",
    description: "Checks claims against evidence.",
    roleId: "fact-checker",
    status: "ACTIVE",
    capabilityIds: [],
    preferredModelId: "fact-checker-model",
    fallbackModelIds: [],
    createdAt: now,
    updatedAt: now,
  };
}

function source(id: string): Source {
  return {
    id,
    kind: "WEB",
    title: "Test source " + id,
    locator: "https://example.test/" + id,
    retrievedAt: now,
  };
}

function evidence(id: string, sourceId: string, kind: Evidence["kind"] = "SUPPORTING"): Evidence {
  return {
    id,
    sourceId,
    kind,
    claim: "The test claim is supported by this evidence.",
    supportingContent: "Deterministic test evidence.",
    capturedAt: now,
  };
}

function serviceSetup() {
  const stores = new InMemoryDomainStores();
  const agents = new InMemoryAgentRegistry();
  agents.register(agent());
  stores.sources.save(source("source-1"));
  stores.sources.save(source("source-2"));
  stores.evidence.save(evidence("evidence-1", "source-1"));
  stores.evidence.save(evidence("evidence-2", "source-2"));
  return { stores, agents };
}

describe("FactCheckService", () => {
  it("checks claims only against referenced evidence and persists a trace", async () => {
    const { stores, agents } = serviceSetup();
    const invokeText = vi.fn(async (input: { agentId: string; request: TextModelRequest }) => {
      expect(input.agentId).toBe("fact-checker");
      expect(input.request.messages[1]?.content).toContain("[claim:claim-1]");
      expect(input.request.messages[1]?.content).toContain("[evidence:evidence-1 source:source-1");
      expect(input.request.messages[1]?.content).toContain("quality:");
      return {
        modelId: "fact-checker-model",
        providerId: "test-provider",
        source: "preferred" as const,
        output: {
          content: JSON.stringify([
            {
              claimId: "claim-1",
              verdict: "SUPPORTED",
              confidence: 0.91,
              rationale: "The supplied evidence directly supports the claim.",
              evidenceIds: ["evidence-1"],
            },
            {
              claimId: "claim-2",
              verdict: "CONTRADICTED",
              confidence: 0.72,
              rationale: "The supplied evidence conflicts with the claim.",
              evidenceIds: ["evidence-2"],
            },
          ]),
        },
      };
    });

    const service = new FactCheckService({
      agents,
      agentGateway: { invokeText } as never,
      evidence: stores.evidence,
      sources: stores.sources,
      events: stores.events,
      unitOfWork: stores,
    });

    const results = await service.execute({
      runId: "run.fact-check",
      factCheckerAgentId: "fact-checker",
      claims: [
        { id: "claim-1", claim: "Claim one.", evidenceIds: ["evidence-1"] },
        { id: "claim-2", claim: "Claim two.", evidenceIds: ["evidence-2"] },
      ],
      requiredCapabilityIds: [],
      now: () => now,
    });

    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({
      claimId: "claim-1",
      verdict: "SUPPORTED",
      confidence: 0.91,
      evidenceIds: ["evidence-1"],
    });
    expect(results[1]).toMatchObject({
      claimId: "claim-2",
      verdict: "CONTRADICTED",
      confidence: 0.72,
      evidenceIds: ["evidence-2"],
    });
    expect(results.every((result) => result.evidenceQuality.length === 1)).toBe(true);

    const events = stores.events.list();
    expect(events.filter((event) => event.kind === "FACT_CHECK_STARTED")).toHaveLength(1);
    expect(events.filter((event) => event.kind === "FACT_CHECK_RESULT")).toHaveLength(2);
    expect(events.filter((event) => event.kind === "FACT_CHECK_COMPLETED")).toHaveLength(1);
  });

  it("rejects unknown evidence instead of silently checking an empty workspace", async () => {
    const { stores, agents } = serviceSetup();
    const service = new FactCheckService({
      agents,
      agentGateway: { invokeText: vi.fn() } as never,
      evidence: stores.evidence,
      sources: stores.sources,
      events: stores.events,
      unitOfWork: stores,
    });

    await expect(
      service.execute({
        factCheckerAgentId: "fact-checker",
        claims: [{ id: "claim-unknown", claim: "Unknown.", evidenceIds: ["missing"] }],
        requiredCapabilityIds: [],
        now: () => now,
      }),
    ).rejects.toThrow("Fact check references unknown evidence: missing.");
  });

  it("falls back to unresolved when the model does not return valid JSON", async () => {
    const { stores, agents } = serviceSetup();
    const service = new FactCheckService({
      agents,
      agentGateway: {
        invokeText: vi.fn(async () => ({
          modelId: "fact-checker-model",
          providerId: "test-provider",
          source: "preferred" as const,
          output: { content: "not valid json" },
        })),
      } as never,
      evidence: stores.evidence,
      sources: stores.sources,
      events: stores.events,
      unitOfWork: stores,
    });

    const results = await service.execute({
      factCheckerAgentId: "fact-checker",
      claims: [{ id: "claim-1", claim: "Claim one.", evidenceIds: ["evidence-1"] }],
      requiredCapabilityIds: [],
      now: () => now,
    });

    expect(results[0]).toMatchObject({
      claimId: "claim-1",
      verdict: "UNRESOLVED",
      evidenceIds: ["evidence-1"],
    });
  });
});
