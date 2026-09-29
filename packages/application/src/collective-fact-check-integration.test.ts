import { describe, expect, it, vi } from "vitest";

import type { Agent, TextModelRequest } from "@polyon/contracts";
import { InMemoryAgentRegistry } from "@polyon/agents";
import { InMemoryDomainStores } from "@polyon/storage";

import { CollectiveOrchestrationService } from "./collective-orchestration-service";
import { FactCheckService } from "./fact-check-service";
import { ResearchService } from "./research-service";

const now = "2026-09-29T10:00:00.000Z";

function agent(id: string, role: string): Agent {
  return {
    id,
    name: id,
    role,
    description: role,
    status: "ACTIVE",
    capabilityIds: [],
    preferredModelId: id + "-model",
    fallbackModelIds: [],
    createdAt: now,
    updatedAt: now,
  };
}

function command() {
  return {
    conversation: {
      id: "conversation.fact-check-integration",
      kind: "COLLABORATIVE" as const,
      status: "ACTIVE" as const,
      participantIds: [
        "user-1",
        "researcher",
        "analyst",
        "synthesizer",
        "fact-checker",
      ],
      messageIds: ["message.fact-check-integration"],
      createdAt: now,
      updatedAt: now,
    },
    message: {
      id: "message.fact-check-integration",
      conversationId: "conversation.fact-check-integration",
      actorId: "user-1",
      role: "USER" as const,
      kind: "TEXT" as const,
      content: "Investigate this issue and verify the team's evidence-backed findings.",
      createdAt: now,
    },
    event: {
      id: "event.fact-check-integration",
      kind: "MESSAGE_CREATED" as const,
      actorId: "user-1",
      conversationId: "conversation.fact-check-integration",
      occurredAt: now,
      data: { messageId: "message.fact-check-integration" },
    },
  };
}

describe("Collective fact-check integration", () => {
  it("fact-checks contributor claims and supplies verdicts to the synthesizer", async () => {
    const stores = new InMemoryDomainStores();
    const agents = new InMemoryAgentRegistry();
    for (const item of [
      agent("researcher", "Research specialist"),
      agent("analyst", "Analytical specialist"),
      agent("synthesizer", "Synthesis lead"),
      agent("fact-checker", "Fact Checker"),
    ]) {
      agents.register(item);
    }

    stores.conversations.save(command().conversation);

    const research = new ResearchService(
      {
        search: vi.fn(async () => [
          {
            title: "Fixture source",
            locator: "https://example.test/source",
            kind: "WEB" as const,
            content: "Independent evidence for the contributor claim.",
            claim: "The contributor claim has supporting evidence.",
            retrievedAt: now,
          },
        ]),
      },
      stores.sources,
      stores.evidence,
      stores.events,
      stores,
    );

    const factCheckInvocations: TextModelRequest[] = [];
    const synthesisInvocations: TextModelRequest[] = [];
    const invokeText = vi.fn(async (input: {
      agentId: string;
      request: TextModelRequest;
    }) => {
      const modelId = input.agentId + "-model";
      const userMessage =
        input.request.messages.find((message) => message.role === "USER")?.content ?? "";

      if (input.agentId === "fact-checker") {
        factCheckInvocations.push(input.request);
        const claims = [
          ...userMessage.matchAll(/\[claim:([^\]\n]+)\] [^\n]+\nEvidence: ([^\n]+)/gu),
        ];
        return {
          agentId: input.agentId,
          modelId,
          providerId: "provider.test",
          source: "preferred" as const,
          output: {
            content: JSON.stringify(
              claims.map((match) => ({
                claimId: match[1],
                verdict: "SUPPORTED",
                confidence: 0.9,
                rationale: "The supplied fixture evidence supports the contributor claim.",
                evidenceIds: [match[2]],
              })),
            ),
          },
        };
      }

      if (input.agentId === "synthesizer") {
        synthesisInvocations.push(input.request);
        return {
          agentId: input.agentId,
          modelId,
          providerId: "provider.test",
          source: "preferred" as const,
          output: {
            content: "Final synthesis includes the fact-check verdicts and evidence.",
          },
        };
      }

      return {
        agentId: input.agentId,
        modelId,
        providerId: "provider.test",
        source: "preferred" as const,
        output: {
          content: "Contributor finding supported by retrieved evidence.",
        },
      };
    });

    const factCheck = new FactCheckService({
      agents,
      agentGateway: { invokeText } as never,
      evidence: stores.evidence,
      sources: stores.sources,
      events: stores.events,
      unitOfWork: stores,
    });

    const service = new CollectiveOrchestrationService({
      agents,
      agentGateway: { invokeText } as never,
      conversations: stores.conversations,
      messages: stores.messages,
      events: stores.events,
      research,
      factCheck,
      unitOfWork: stores,
    });

    const result = await service.execute({
      command: command(),
      targets: [
        { agentId: "researcher", actorId: "researcher" },
        { agentId: "analyst", actorId: "analyst" },
        { agentId: "synthesizer", actorId: "synthesizer" },
      ],
      actorId: "user-1",
      requiredCapabilityIds: [],
      synthesizerAgentId: "synthesizer",
      researchEnabled: true,
      researchSourceLimit: 1,
      factCheckerAgentId: "fact-checker",
      maxChallengeRounds: 0,
      now: () => now,
    });

    expect(result.status).toBe("SUCCEEDED");
    expect(result.factChecks).toHaveLength(2);
    expect(result.factChecks?.every((item) => item.verdict === "SUPPORTED")).toBe(true);
    expect(result.factChecks?.every((item) => item.evidenceIds.length === 1)).toBe(true);
    expect(factCheckInvocations.length).toBe(1);
    expect(synthesisInvocations).toHaveLength(1);
    expect(synthesisInvocations[0]?.messages[1]?.content).toContain("Fact-check results:");
    expect(synthesisInvocations[0]?.messages[1]?.content).toContain("SUPPORTED");
    expect(synthesisInvocations[0]?.messages[1]?.content).toContain("evidence");

    const events = stores.events.list();
    expect(events.filter((event) => event.kind === "FACT_CHECK_STARTED")).toHaveLength(1);
    expect(events.filter((event) => event.kind === "FACT_CHECK_RESULT")).toHaveLength(2);
    expect(events.filter((event) => event.kind === "FACT_CHECK_COMPLETED")).toHaveLength(1);
  });
});
