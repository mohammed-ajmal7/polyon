import { describe, expect, it, vi } from "vitest";

import { FileDomainStores, InMemoryDomainStores } from "@polyon/storage";

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
});
