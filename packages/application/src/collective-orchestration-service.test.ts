import { describe, expect, it, vi } from "vitest";

import type { Agent, TextModelRequest } from "@polyon/contracts";
import { InMemoryAgentRegistry } from "@polyon/agents";
import { InMemoryDomainStores } from "@polyon/storage";

import type { CommandIngressResult } from "./command-ingress";
import { CollectiveOrchestrationService } from "./collective-orchestration-service";
import { ResearchService } from "./research-service";

const now = "2026-09-28T13:00:00.000Z";

function agent(id: string, role: string): Agent {
  return {
    id,
    name: id.toUpperCase(),
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

function command(): CommandIngressResult {
  return {
    conversation: {
      id: "conversation.collective",
      kind: "COLLABORATIVE",
      status: "ACTIVE",
      participantIds: ["user-1", "researcher", "analyst", "synthesizer"],
      messageIds: ["message.user"],
      createdAt: now,
      updatedAt: now,
    },
    message: {
      id: "message.user",
      conversationId: "conversation.collective",
      actorId: "user-1",
      role: "USER",
      kind: "TEXT",
      content: "Investigate the problem and explain what the team found.",
      createdAt: now,
    },
    event: {
      id: "event.user",
      kind: "MESSAGE_CREATED",
      actorId: "user-1",
      conversationId: "conversation.collective",
      occurredAt: now,
      data: {
        messageId: "message.user",
      },
    },
  };
}

describe("CollectiveOrchestrationService", () => {
  it("runs contributor agents in parallel and persists one synthesized conversation result", async () => {
    const stores = new InMemoryDomainStores();
    stores.conversations.save(command().conversation);
    stores.messages.save(command().message);

    const agents = new InMemoryAgentRegistry();
    agents.register(agent("researcher", "Research specialist"));
    agents.register(agent("analyst", "Analytical specialist"));
    agents.register(agent("synthesizer", "Synthesis lead"));

    const barriers: Promise<void>[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const invokeText = vi.fn(async ({ agentId }: { agentId: string }) => {
      if (agentId !== "synthesizer") {
        barriers.push(gate);
        await gate;
      }

      return {
        modelId: agentId + "-model",
        providerId: "test-provider",
        output: {
          content:
            agentId === "researcher"
              ? "Research found the primary fact."
              : agentId === "analyst"
                ? "Analysis identified the strongest explanation."
                : "Findings synthesized with disagreements and uncertainty.",
        },
      };
    });

    const service = new CollectiveOrchestrationService({
      agents,
      agentGateway: { invokeText } as never,
      conversations: stores.conversations,
      messages: stores.messages,
      events: stores.events,
      unitOfWork: stores,
    });

    const resultPromise = service.execute({
      command: command(),
      targets: [
        { agentId: "researcher", actorId: "researcher" },
        { agentId: "analyst", actorId: "analyst" },
        { agentId: "synthesizer", actorId: "synthesizer" },
      ],
      actorId: "user-1",
      requiredCapabilityIds: [],
      synthesizerAgentId: "synthesizer",
      now: () => now,
    });

    await vi.waitFor(() => expect(invokeText).toHaveBeenCalledTimes(2));
    expect(barriers).toHaveLength(2);
    release();

    const result = await resultPromise;

    expect(result.status).toBe("SUCCEEDED");
    expect(result.failures).toEqual([]);
    expect(result.contributions.map((item) => item.agentId)).toEqual(["researcher", "analyst"]);
    expect(result.synthesis?.content).toContain("Findings synthesized");
    expect(stores.messages.list()).toHaveLength(4);
    expect(stores.events.list().map((event) => event.kind)).toEqual([
      "COLLECTIVE_STARTED",
      "COLLECTIVE_CONTRIBUTION",
      "COLLECTIVE_CONTRIBUTION",
      "COLLECTIVE_SYNTHESIZED",
    ]);
  });

  it("continues with the remaining contributors when one contributor fails", async () => {
    const stores = new InMemoryDomainStores();
    stores.conversations.save(command().conversation);
    stores.messages.save(command().message);

    const agents = new InMemoryAgentRegistry();
    agents.register(agent("researcher", "Research specialist"));
    agents.register(agent("analyst", "Analytical specialist"));
    agents.register(agent("synthesizer", "Synthesis lead"));

    const invokeText = vi.fn(async ({ agentId }: { agentId: string }) => {
      if (agentId === "researcher") throw new Error("research service unavailable");
      return {
        modelId: agentId + "-model",
        providerId: "test-provider",
        output: {
          content:
            agentId === "analyst"
              ? "The remaining analyst found a useful explanation."
              : "Synthesis includes a failed researcher and remaining evidence.",
        },
      };
    });

    const service = new CollectiveOrchestrationService({
      agents,
      agentGateway: { invokeText } as never,
      conversations: stores.conversations,
      messages: stores.messages,
      events: stores.events,
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
      now: () => now,
    });

    expect(result.status).toBe("PARTIAL");
    expect(result.failures).toEqual([
      {
        agentId: "researcher",
        actorId: "researcher",
        error: "research service unavailable",
      },
    ]);
    expect(result.synthesis?.content).toContain("failed researcher");
  });

  it("researches per contributor and gives source-backed evidence to the synthesizer", async () => {
    const stores = new InMemoryDomainStores();
    stores.conversations.save(command().conversation);
    stores.messages.save(command().message);

    const agents = new InMemoryAgentRegistry();
    agents.register(agent("researcher", "Research specialist"));
    agents.register(agent("analyst", "Analytical specialist"));
    agents.register(agent("synthesizer", "Synthesis lead"));

    const retriever = {
      search: vi.fn(async (query: string) => [
        {
          title: query.includes("Research specialist") ? "Research source" : "Analysis source",
          locator: query.includes("Research specialist")
            ? "https://example.com/research"
            : "https://example.com/analysis",
          kind: "WEB" as const,
          content: query.includes("Research specialist")
            ? "Primary evidence from the research source."
            : "Independent evidence from the analysis source.",
          claim: "A supported claim.",
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

    const requests: TextModelRequest[] = [];
    const invokeText = vi.fn(async (input: { agentId: string; request: TextModelRequest }) => {
      requests.push(input.request);
      return {
        modelId: input.agentId + "-model",
        providerId: "test-provider",
        output: {
          content:
            input.agentId === "synthesizer"
              ? "Synthesized from evidence and team findings."
              : "Contributor finding grounded in retrieved evidence.",
        },
      };
    });

    const service = new CollectiveOrchestrationService({
      agents,
      agentGateway: { invokeText } as never,
      conversations: stores.conversations,
      messages: stores.messages,
      events: stores.events,
      research,
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
      now: () => now,
    });

    expect(result.status).toBe("SUCCEEDED");
    expect(result.sourceIds).toHaveLength(2);
    expect(result.evidenceIds).toHaveLength(2);
    expect(stores.evidence.list().every((item) => item.taskId === result.collectiveId)).toBe(true);

    const synthesisRequest = requests.find((request) =>
      request.messages.some(
        (message) =>
          message.role === "USER" &&
          message.content.includes("Shared evidence"),
      ),
    );
    expect(
      synthesisRequest?.messages.some((message) =>
        message.content.includes("Primary evidence from the research source."),
      ),
    ).toBe(true);
  });

  it("requires at least two distinct active participants", async () => {
    const stores = new InMemoryDomainStores();
    const agents = new InMemoryAgentRegistry();
    agents.register(agent("only", "Generalist"));

    const service = new CollectiveOrchestrationService({
      agents,
      agentGateway: { invokeText: vi.fn() } as never,
      conversations: stores.conversations,
      messages: stores.messages,
      events: stores.events,
      unitOfWork: stores,
    });

    await expect(
      service.execute({
        command: {
          ...command(),
          message: { ...command().message, actorId: "user-1" },
        },
        targets: [{ agentId: "only", actorId: "only" }],
        actorId: "user-1",
        requiredCapabilityIds: [],
        now: () => now,
      }),
    ).rejects.toThrow("Collective execution requires 2-8 agents.");
  });
});
