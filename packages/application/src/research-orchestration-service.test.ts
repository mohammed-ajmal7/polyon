import { describe, expect, it, vi } from "vitest";

import type { Agent, TextModelRequest } from "@polyon/contracts";
import { InMemoryAgentRegistry } from "@polyon/agents";
import { InMemoryDomainStores } from "@polyon/storage";

import type { CommandIngressResult } from "./command-ingress";
import { ResearchOrchestrationService } from "./research-orchestration-service";
import { ResearchService, type ResearchRetriever } from "./research-service";

const now = "2026-09-28T20:00:00.000Z";

function command(): CommandIngressResult {
  return {
    conversation: {
      id: "conversation.research",
      kind: "RESEARCH",
      status: "ACTIVE",
      participantIds: ["user-1", "researcher-a", "researcher-b", "synthesizer"],
      messageIds: ["message.user"],
      createdAt: now,
      updatedAt: now,
    },
    message: {
      id: "message.user",
      conversationId: "conversation.research",
      actorId: "user-1",
      role: "USER",
      kind: "TEXT",
      content: "Research the strongest explanations and identify what remains uncertain.",
      createdAt: now,
    },
    event: {
      id: "event.user",
      kind: "MESSAGE_CREATED",
      actorId: "user-1",
      conversationId: "conversation.research",
      occurredAt: now,
      data: { messageId: "message.user" },
    },
  };
}

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

function dependencies() {
  const stores = new InMemoryDomainStores();
  const agents = new InMemoryAgentRegistry();

  for (const item of [
    agent("researcher-a", "Company research specialist"),
    agent("researcher-b", "Macro research specialist"),
    agent("synthesizer", "Research synthesis lead"),
  ]) {
    agents.register(item);
  }

  return { stores, agents };
}

describe("ResearchOrchestrationService", () => {
  it("runs independent research, agent analysis, and one sourced synthesis", async () => {
    const { stores, agents } = dependencies();
    const search = vi.fn(async (query: string) => [
      {
        title: query.includes("Macro") ? "Macro source" : "Company source",
        locator: query.includes("Macro")
          ? "https://example.com/macro"
          : "https://example.com/company",
        kind: "WEB" as const,
        content: "Bounded evidence excerpt.",
        claim: "The source supports a candidate explanation.",
        retrievedAt: now,
      },
    ]);
    const retriever: ResearchRetriever = { search };
    const research = new ResearchService(
      retriever,
      stores.sources,
      stores.evidence,
      stores.events,
      stores,
    );
    const invokeText = vi.fn(
      async ({ agentId, request }: { agentId: string; request: TextModelRequest }) => {
        void request;
        return {
          agentId,
          modelId: agentId + "-model",
          providerId: "provider-" + agentId,
          source: "preferred" as const,
          output: {
            content:
              agentId === "synthesizer"
                ? "Findings\nTwo independent signals were found.\nEvidence\n[source:research-evidence]"
                : agentId + " found a supported signal and identified uncertainty.",
          },
        };
      },
    );

    const service = new ResearchOrchestrationService({
      agents,
      agentGateway: { invokeText } as never,
      research,
      conversations: stores.conversations,
      messages: stores.messages,
      events: stores.events,
      unitOfWork: stores,
    });

    stores.conversations.save(command().conversation);

    const result = await service.execute({
      command: command(),
      targets: [
        { agentId: "researcher-a", actorId: "researcher-a" },
        { agentId: "researcher-b", actorId: "researcher-b" },
        { agentId: "synthesizer", actorId: "synthesizer" },
      ],
      actorId: "user-1",
      requiredCapabilityIds: [],
      maxParticipants: 3,
      sourceLimit: 1,
      now: () => now,
    });

    expect(result.status).toBe("SUCCEEDED");
    expect(result.findings).toHaveLength(2);
    expect(result.failures).toHaveLength(0);
    expect(result.sourceIds).toHaveLength(2);
    expect(result.evidenceIds).toHaveLength(2);
    expect(result.synthesis?.actorId).toBe("synthesizer");
    expect(stores.messages.get(result.synthesis!.id)?.content).toContain("Two independent signals");
    expect(stores.events.list().filter((event) => event.kind === "RESEARCH_FINDING")).toHaveLength(
      2,
    );
    expect(
      stores.events.list().filter((event) => event.kind === "RESEARCH_COMPLETED"),
    ).toHaveLength(1);
    expect(search).toHaveBeenCalledTimes(2);
    expect(invokeText).toHaveBeenCalledTimes(3);

    const synthesisCall = invokeText.mock.calls.at(-1)?.[0];
    expect(synthesisCall?.request.messages[1]?.content).toContain("Bounded evidence excerpt.");
    expect(synthesisCall?.request.messages[1]?.content).toContain("Research workspace:");
  });

  it("attaches a structured finding when a researcher returns a valid envelope", async () => {
    const { stores, agents } = dependencies();
    const retriever: ResearchRetriever = {
      search: vi.fn(async () => [
        {
          title: "Company source",
          locator: "https://example.com/company",
          kind: "WEB" as const,
          content: "Company evidence.",
          claim: "A company-specific signal exists.",
          retrievedAt: now,
        },
      ]),
    };
    const research = new ResearchService(
      retriever,
      stores.sources,
      stores.evidence,
      stores.events,
      stores,
    );
    const invokeText = vi.fn(
      async ({ agentId, request }: { agentId: string; request: TextModelRequest }) => {
        const evidenceMatch = request.messages[1]?.content.match(/\[evidence:([^\s\]]+)/u);
        const evidenceId = evidenceMatch?.[1] ?? "missing";
        return {
          agentId,
          modelId: agentId + "-model",
          providerId: "provider-" + agentId,
          source: "preferred" as const,
          output: {
            content:
              agentId === "synthesizer"
                ? "Synthesis from the structured finding."
                : [
                    "Researcher explanation.",
                    JSON.stringify({
                      claim: "A company-specific signal exists.",
                      confidence: 0.9,
                      assumptions: ["The retrieved source is authentic."],
                      counterarguments: ["The signal may be coincidental."],
                      disposition: "SUPPORTED",
                      evidenceIds: [evidenceId],
                    }),
                  ].join("\n"),
          },
        };
      },
    );

    const service = new ResearchOrchestrationService({
      agents,
      agentGateway: { invokeText } as never,
      research,
      conversations: stores.conversations,
      messages: stores.messages,
      events: stores.events,
      unitOfWork: stores,
    });
    stores.conversations.save(command().conversation);

    const result = await service.execute({
      command: command(),
      targets: [
        { agentId: "researcher-a", actorId: "researcher-a" },
        { agentId: "researcher-b", actorId: "researcher-b" },
        { agentId: "synthesizer", actorId: "synthesizer" },
      ],
      actorId: "user-1",
      requiredCapabilityIds: [],
      maxParticipants: 3,
      sourceLimit: 1,
      now: () => now,
    });

    const structured = result.findings.find(
      (finding) => finding.agentId === "researcher-a",
    )?.finding;

    expect(structured).toEqual(
      expect.objectContaining({
        claim: "A company-specific signal exists.",
        confidence: 0.9,
        disposition: "SUPPORTED",
      }),
    );
    expect(
      stores.events
        .list()
        .find((event) => event.kind === "RESEARCH_FINDING" && event.data.agentId === "researcher-a")
        ?.data.finding,
    ).toEqual(
      expect.objectContaining({
        confidence: 0.9,
        disposition: "SUPPORTED",
      }),
    );
  });

  it("keeps successful research when one researcher fails", async () => {
    const { stores, agents } = dependencies();
    const retriever: ResearchRetriever = {
      search: vi.fn(async (query: string) => {
        if (query.includes("Macro")) throw new Error("search unavailable");
        return [
          {
            title: "Company source",
            locator: "https://example.com/company",
            kind: "WEB" as const,
            content: "Company evidence.",
            claim: "A company-specific signal exists.",
            retrievedAt: now,
          },
        ];
      }),
    };
    const research = new ResearchService(
      retriever,
      stores.sources,
      stores.evidence,
      stores.events,
      stores,
    );
    const invokeText = vi.fn(async ({ agentId }: { agentId: string }) => ({
      agentId,
      modelId: agentId + "-model",
      providerId: "provider-" + agentId,
      source: "preferred" as const,
      output: {
        content:
          agentId === "synthesizer"
            ? "Findings\nOne supported finding survived the failed researcher."
            : "Supported researcher analysis.",
      },
    }));

    const service = new ResearchOrchestrationService({
      agents,
      agentGateway: { invokeText } as never,
      research,
      conversations: stores.conversations,
      messages: stores.messages,
      events: stores.events,
      unitOfWork: stores,
    });

    stores.conversations.save(command().conversation);

    const result = await service.execute({
      command: command(),
      targets: [
        { agentId: "researcher-a", actorId: "researcher-a" },
        { agentId: "researcher-b", actorId: "researcher-b" },
        { agentId: "synthesizer", actorId: "synthesizer" },
      ],
      actorId: "user-1",
      requiredCapabilityIds: [],
      maxParticipants: 3,
      sourceLimit: 1,
      now: () => now,
    });

    expect(result.status).toBe("PARTIAL");
    expect(result.findings).toHaveLength(1);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]?.stage).toBe("RESEARCH");
    expect(result.synthesis).toBeDefined();
    expect(stores.events.list().some((event) => event.kind === "RESEARCH_COMPLETED")).toBe(true);
  });

  it("requires a multi-agent research team", async () => {
    const { stores, agents } = dependencies();
    const research = new ResearchService(
      { search: vi.fn(async () => []) },
      stores.sources,
      stores.evidence,
      stores.events,
    );
    const service = new ResearchOrchestrationService({
      agents,
      agentGateway: { invokeText: vi.fn() } as never,
      research,
      conversations: stores.conversations,
      messages: stores.messages,
      events: stores.events,
    });

    stores.conversations.save(command().conversation);

    await expect(
      service.execute({
        command: command(),
        targets: [{ agentId: "researcher-a", actorId: "researcher-a" }],
        actorId: "user-1",
        requiredCapabilityIds: [],
      }),
    ).rejects.toThrow("2-8 agents");
  });
});
