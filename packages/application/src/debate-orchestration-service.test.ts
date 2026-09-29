import { describe, expect, it, vi } from "vitest";

import { InMemoryDomainStores } from "@polyon/storage";

import { DebateOrchestrationService } from "./debate-orchestration-service";

describe("DebateOrchestrationService", () => {
  it("runs a finite debate and persists every contribution and decision", async () => {
    const stores = new InMemoryDomainStores();
    const invokeText = vi.fn(async ({ agentId }: { agentId: string }) => ({
      agentId,
      modelId: "model-1",
      providerId: "provider-1",
      source: "preferred" as const,
      output: { content: `${agentId} response` },
    }));
    const service = new DebateOrchestrationService(
      { invokeText } as never,
      stores.debates,
      stores.events,
      stores,
    );

    const debate = service.create({
      id: "debate-1",
      objective: "Decide between two approaches.",
      participantAgentIds: ["agent-a", "agent-b"],
      maxParticipants: 2,
      maxRounds: 1,
      createdAt: "2026-09-28T00:00:00.000Z",
    });

    const result = await service.run({
      debateId: debate.id,
      requiredCapabilityIds: [],
      adjudicatorAgentId: "agent-a",
      now: () => "2026-09-28T00:00:01.000Z",
    });

    expect(result.debate.status).toBe("DECIDED");
    expect(result.decision).toBe("agent-a response");
    expect(result.contributions).toHaveLength(8);
    expect(
      stores.events.list().filter((event) => event.kind === "DEBATE_CONTRIBUTION"),
    ).toHaveLength(8);
    expect(stores.events.list().filter((event) => event.kind === "DEBATE_DECIDED")).toHaveLength(1);
    expect(invokeText).toHaveBeenCalledTimes(9);
  });

  it("reuses persisted contributions and returns an existing decision on restart", async () => {
    const stores = new InMemoryDomainStores();
    const invokeText = vi.fn(async () => ({
      agentId: "agent-a",
      modelId: "model-1",
      providerId: "provider-1",
      source: "preferred" as const,
      output: { content: "new response" },
    }));
    const service = new DebateOrchestrationService(
      { invokeText } as never,
      stores.debates,
      stores.events,
      stores,
    );

    service.create({
      id: "debate-2",
      objective: "Test recovery.",
      participantAgentIds: ["agent-a", "agent-b"],
      maxParticipants: 2,
      maxRounds: 1,
      createdAt: "2026-09-28T00:00:00.000Z",
    });

    const first = await service.run({
      debateId: "debate-2",
      requiredCapabilityIds: [],
      adjudicatorAgentId: "agent-a",
      now: () => "2026-09-28T00:00:01.000Z",
    });

    const callsAfterFirst = invokeText.mock.calls.length;
    const second = await service.run({
      debateId: "debate-2",
      requiredCapabilityIds: [],
      adjudicatorAgentId: "agent-a",
      now: () => "2026-09-28T00:00:02.000Z",
    });

    expect(second.decision).toBe(first.decision);
    expect(second.contributions).toHaveLength(8);
    expect(invokeText).toHaveBeenCalledTimes(callsAfterFirst);
  });

  it("replays persisted contributions in round and debate phase order on resume", async () => {
    const stores = new InMemoryDomainStores();
    let failRebuttal = true;
    const prompts: string[] = [];
    const invokeText = vi.fn(async ({ agentId, request }: InvokeInput) => {
      const prompt = request.messages.find((message) => message.role === "USER")?.content ?? "";
      prompts.push(prompt);
      if (failRebuttal && prompt.includes("Phase: REBUTTAL")) {
        failRebuttal = false;
        throw new Error("simulated interruption");
      }
      return reply(agentId, `${agentId} says`);
    });
    const service = new DebateOrchestrationService(
      { invokeText } as never,
      stores.debates,
      stores.events,
      stores,
    );
    service.create({
      id: "debate-order",
      objective: "Test ordering.",
      participantAgentIds: ["agent-a", "agent-b"],
      maxParticipants: 2,
      maxRounds: 1,
      createdAt: "2026-09-28T00:00:00.000Z",
    });
    const run = () =>
      service.run({
        debateId: "debate-order",
        requiredCapabilityIds: [],
        adjudicatorAgentId: "agent-a",
        now: () => "2026-09-28T00:00:01.000Z",
      });

    await expect(run()).rejects.toThrow("simulated interruption");
    const result = await run();

    expect(result.contributions.map((item) => item.phase)).toEqual([
      "PROPOSAL",
      "PROPOSAL",
      "CRITICISM",
      "CRITICISM",
      "EVIDENCE",
      "EVIDENCE",
      "REBUTTAL",
      "REBUTTAL",
    ]);
    const resumedPrompt = prompts.at(-3) ?? "";
    expect(resumedPrompt).toContain("Phase: REBUTTAL");
    expect(resumedPrompt.indexOf("/PROPOSAL/")).toBeLessThan(resumedPrompt.indexOf("/CRITICISM/"));
    expect(resumedPrompt.indexOf("/CRITICISM/")).toBeLessThan(resumedPrompt.indexOf("/EVIDENCE/"));
  });

  it("keeps oversized and most recent contributions within the prompt budget", async () => {
    const stores = new InMemoryDomainStores();
    const prompts: { agentId: string; prompt: string }[] = [];
    const invokeText = vi.fn(async ({ agentId, request }: InvokeInput) => {
      const prompt = request.messages.find((message) => message.role === "USER")?.content ?? "";
      prompts.push({ agentId, prompt });
      return reply(agentId, "x".repeat(prompts.length === 1 ? 50_000 : 20_000));
    });
    const service = new DebateOrchestrationService(
      { invokeText } as never,
      stores.debates,
      stores.events,
      stores,
    );
    service.create({
      id: "debate-budget",
      objective: "Test budgets.",
      participantAgentIds: ["agent-a", "agent-b"],
      maxParticipants: 2,
      maxRounds: 1,
      createdAt: "2026-09-28T00:00:00.000Z",
    });

    await service.run({
      debateId: "debate-budget",
      requiredCapabilityIds: [],
      adjudicatorAgentId: "agent-a",
      now: () => "2026-09-28T00:00:01.000Z",
    });

    const secondProposal = prompts[1]!.prompt;
    expect(secondProposal).toContain("[1/PROPOSAL/agent-a]");
    expect(secondProposal).toContain("[... truncated");

    const adjudication = prompts.at(-1)!.prompt;
    expect(adjudication).toContain("[1/REBUTTAL/agent-a]");
    expect(adjudication).toContain("[1/REBUTTAL/agent-b]");
    expect(adjudication).toMatch(/earlier entries omitted/u);
  });
});

interface InvokeInput {
  readonly agentId: string;
  readonly request: { readonly messages: readonly { role: string; content: string }[] };
}

function reply(agentId: string, content: string) {
  return {
    agentId,
    modelId: "model-1",
    providerId: "provider-1",
    source: "preferred" as const,
    output: { content },
  };
}
