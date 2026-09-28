import { describe, expect, it, vi } from "vitest";

import type { Agent, Debate, Message } from "@polyon/contracts";
import { InMemoryAgentRegistry } from "@polyon/agents";
import { InMemoryDomainStores } from "@polyon/storage";

import type { CommandIngressResult } from "./command-ingress";
import type { CollectiveExecutionResult } from "./collective-orchestration-service";
import type { DebateRunResult } from "./debate-orchestration-service";
import { DeepAnalysisOrchestrationService } from "./deep-analysis-orchestration-service";

const now = "2026-09-28T18:00:00.000Z";

function command(): CommandIngressResult {
  return {
    conversation: {
      id: "conversation.deep-analysis",
      kind: "DEEP_ANALYSIS",
      status: "ACTIVE",
      participantIds: ["user-1", "researcher", "analyst", "synthesizer"],
      messageIds: ["message.user"],
      createdAt: now,
      updatedAt: now,
    },
    message: {
      id: "message.user",
      conversationId: "conversation.deep-analysis",
      actorId: "user-1",
      role: "USER",
      kind: "TEXT",
      content: "Investigate this deeply and challenge the strongest explanations.",
      createdAt: now,
    },
    event: {
      id: "event.user",
      kind: "MESSAGE_CREATED",
      actorId: "user-1",
      conversationId: "conversation.deep-analysis",
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

function collectiveResult(): CollectiveExecutionResult {
  const synthesis: Message = {
    id: "collective:synthesis",
    conversationId: command().conversation.id,
    actorId: "synthesizer",
    role: "AGENT",
    kind: "TEXT",
    content: "Collective synthesis with competing explanations.",
    createdAt: now,
  };

  return {
    collectiveId: "collective:deep-analysis",
    conversationId: command().conversation.id,
    status: "SUCCEEDED",
    synthesizerAgentId: "synthesizer",
    contributions: [
      {
        agentId: "researcher",
        actorId: "researcher",
        role: "Research specialist",
        modelId: "researcher-model",
        providerId: "ollama",
        content: "Research finding.",
        sourceIds: [],
        evidenceIds: [],
      },
      {
        agentId: "analyst",
        actorId: "analyst",
        role: "Analytical specialist",
        modelId: "analyst-model",
        providerId: "ollama",
        content: "Analytical finding.",
        sourceIds: [],
        evidenceIds: [],
      },
    ],
    challenges: [],
    failures: [],
    sourceIds: [],
    evidenceIds: [],
    synthesis,
  };
}

function debateResult(): DebateRunResult {
  const debate: Debate = {
    id: "deep-analysis:conversation.deep-analysis:message.user:debate",
    objective: command().message.content,
    participantAgentIds: ["researcher", "analyst", "synthesizer"],
    maxParticipants: 3,
    maxRounds: 2,
    currentRound: 2,
    phase: "ADJUDICATION",
    status: "DECIDED",
    createdAt: now,
    updatedAt: now,
    decidedAt: now,
  };

  return {
    debate,
    decision: "The strongest conclusion remains conditional on the evidence.",
    contributions: [
      {
        agentId: "researcher",
        round: 1,
        phase: "PROPOSAL",
        content: "Research proposes the primary explanation.",
      },
      {
        agentId: "analyst",
        round: 1,
        phase: "CRITICISM",
        content: "Analysis challenges the primary explanation.",
      },
    ],
  };
}

describe("DeepAnalysisOrchestrationService", () => {
  it("runs collective analysis followed by a bounded debate and persists the final decision", async () => {
    const stores = new InMemoryDomainStores();
    stores.conversations.save(command().conversation);
    stores.messages.save(command().message);

    const agents = new InMemoryAgentRegistry();
    agents.register(agent("researcher", "Research specialist"));
    agents.register(agent("analyst", "Analytical specialist"));
    agents.register(agent("synthesizer", "Synthesis lead"));

    const collective = collectiveResult();
    const debate = debateResult();

    const collectiveExecute = vi.fn(async () => collective);
    const debateCreate = vi.fn(() => debate.debate);
    const debateRun = vi.fn(async () => debate);

    const service = new DeepAnalysisOrchestrationService({
      collective: { execute: collectiveExecute } as never,
      debates: { create: debateCreate, run: debateRun } as never,
      agents,
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
      maxDebateRounds: 2,
      now: () => now,
    });

    expect(collectiveExecute).toHaveBeenCalledOnce();
    expect(debateCreate).toHaveBeenCalledOnce();
    expect(debateRun).toHaveBeenCalledOnce();
    expect(result.status).toBe("SUCCEEDED");
    expect(result.decision?.content).toContain("conditional");
    expect(stores.messages.get(result.decision!.id)?.content).toContain("conditional");
    expect(stores.events.list().map((event) => event.kind)).toEqual([
      "DEEP_ANALYSIS_STARTED",
      "DEEP_ANALYSIS_COMPLETED",
    ]);
  });

  it("stops before debate when the collective produces no synthesis", async () => {
    const stores = new InMemoryDomainStores();
    stores.conversations.save(command().conversation);
    stores.messages.save(command().message);

    const agents = new InMemoryAgentRegistry();
    agents.register(agent("researcher", "Research specialist"));
    agents.register(agent("analyst", "Analytical specialist"));
    agents.register(agent("synthesizer", "Synthesis lead"));

    const failedCollective: CollectiveExecutionResult = {
      ...collectiveResult(),
      status: "FAILED",
      synthesis: undefined,
    };
    const debateRun = vi.fn();

    const service = new DeepAnalysisOrchestrationService({
      collective: { execute: vi.fn(async () => failedCollective) } as never,
      debates: { create: vi.fn(), run: debateRun } as never,
      agents,
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
      now: () => now,
    });

    expect(result.status).toBe("FAILED");
    expect(result.debate).toBeUndefined();
    expect(debateRun).not.toHaveBeenCalled();
    expect(stores.events.list().map((event) => event.kind)).toEqual([
      "DEEP_ANALYSIS_STARTED",
      "ERROR",
    ]);
  });
});
