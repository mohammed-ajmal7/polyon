import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Agent, Model, Provider } from "@polyon/contracts";
import type { ModelProviderAdapter, ProviderInvocationRequest } from "@polyon/providers";
import { describe, expect, it } from "vitest";

import { createPolyonComposition, type PolyonProviderRegistration } from "./polyon-composition";

const now = "2026-09-28T21:00:00.000Z";

interface Invocation {
  readonly modelId: string;
  readonly input: unknown;
}

function makeProvider(
  providerId: string,
  role: string,
  invocations: Invocation[],
): PolyonProviderRegistration {
  const provider: Provider = {
    id: providerId,
    name: role + " provider",
    kind: "HOSTED_MODEL",
    enabled: true,
  };

  const adapter: ModelProviderAdapter = {
    providerId,
    async invoke(request: ProviderInvocationRequest) {
      invocations.push({
        modelId: request.modelId,
        input: request.input,
      });

      return {
        output: {
          content:
            role +
            " response from " +
            request.modelId +
            ". Distinguish evidence from interpretation and preserve uncertainty.",
        },
      };
    },
  };

  return { provider, adapter };
}

function makeAgent(agentId: string, modelId: string, role: string, providerId: string): Agent {
  return {
    id: agentId,
    name: agentId,
    role,
    description: role,
    status: "ACTIVE",
    capabilityIds: [],
    preferredModelId: modelId,
    fallbackModelIds: [],
    createdAt: now,
    updatedAt: now,
  };
}

function makeModel(modelId: string, providerId: string): Model {
  return {
    id: modelId,
    name: modelId,
    kind: "TEXT",
    providerId,
    capabilityIds: [],
    enabled: true,
  };
}

describe("POLYON deep-analysis composition", () => {
  it("runs collective analysis and a bounded debate through distinct model providers", async () => {
    const root = mkdtempSync(join(tmpdir(), "polyon-deep-analysis-composition-"));
    const invocations: Record<string, Invocation[]> = {
      researcher: [],
      analyst: [],
      synthesizer: [],
    };

    try {
      const providers = [
        makeProvider("provider.research", "Research", invocations.researcher),
        makeProvider("provider.analysis", "Analysis", invocations.analyst),
        makeProvider("provider.synthesis", "Synthesis", invocations.synthesizer),
      ];
      const agents = [
        makeAgent("researcher", "model.researcher", "Research specialist", "provider.research"),
        makeAgent("analyst", "model.analyst", "Analytical specialist", "provider.analysis"),
        makeAgent(
          "synthesizer",
          "model.synthesizer",
          "Synthesis and adjudication lead",
          "provider.synthesis",
        ),
      ];
      const models = [
        makeModel("model.researcher", "provider.research"),
        makeModel("model.analyst", "provider.analysis"),
        makeModel("model.synthesizer", "provider.synthesis"),
      ];

      const composition = createPolyonComposition({
        storageRoot: root,
        providers,
        models,
        agents,
      });

      const command = composition.commandIngress.submit({
        mode: "DeepAnalysis",
        command:
          "Investigate why a system incident occurred and challenge the strongest explanations.",
        actorId: "user.test",
        conversationId: "conversation.deep-analysis.integration",
        messageId: "message.deep-analysis.integration",
        eventId: "event.deep-analysis.integration",
        participantIds: ["user.test", ...agents.map((agent) => agent.id)],
        createdAt: now,
      });

      const result = await composition.deepAnalysisOrchestration.execute({
        command,
        targets: agents.map((agent) => ({
          agentId: agent.id,
          actorId: agent.id,
        })),
        actorId: "user.test",
        requiredCapabilityIds: [],
        synthesizerAgentId: "synthesizer",
        maxParticipants: 3,
        maxChallengeRounds: 1,
        maxDebateRounds: 1,
        now: () => now,
      });

      expect(result.status).toBe("SUCCEEDED");
      expect(result.collective.status).toBe("SUCCEEDED");
      expect(result.collective.contributions.map((item) => item.agentId)).toEqual([
        "researcher",
        "analyst",
      ]);
      expect(result.collective.contributions.map((item) => item.modelId)).toEqual([
        "model.researcher",
        "model.analyst",
      ]);
      expect(result.collective.contributions.map((item) => item.providerId)).toEqual([
        "provider.research",
        "provider.analysis",
      ]);
      expect(result.collective.challenges).toHaveLength(3);
      expect(result.collective.synthesis?.actorId).toBe("synthesizer");
      expect(result.collective.synthesis?.content).toContain("Synthesis response");

      expect(result.debate?.debate.status).toBe("DECIDED");
      expect(result.debate?.contributions).toHaveLength(12);
      expect(result.decision?.actorId).toBe("synthesizer");
      expect(result.decision?.content).toContain("Synthesis response");

      expect(invocations.researcher.length).toBeGreaterThan(0);
      expect(invocations.analyst.length).toBeGreaterThan(0);
      expect(invocations.synthesizer.length).toBeGreaterThan(0);
      expect(invocations.researcher.every((item) => item.modelId === "model.researcher")).toBe(
        true,
      );
      expect(invocations.analyst.every((item) => item.modelId === "model.analyst")).toBe(true);
      expect(invocations.synthesizer.every((item) => item.modelId === "model.synthesizer")).toBe(
        true,
      );

      const events = composition.stores.events.list();
      expect(events.filter((event) => event.kind === "DEEP_ANALYSIS_STARTED")).toHaveLength(1);
      expect(events.filter((event) => event.kind === "COLLECTIVE_CONTRIBUTION")).toHaveLength(2);
      expect(events.filter((event) => event.kind === "COLLECTIVE_CHALLENGE")).toHaveLength(3);
      expect(events.filter((event) => event.kind === "COLLECTIVE_SYNTHESIZED")).toHaveLength(1);
      expect(events.filter((event) => event.kind === "DEBATE_CONTRIBUTION")).toHaveLength(12);
      expect(events.filter((event) => event.kind === "DEBATE_DECIDED")).toHaveLength(1);
      expect(events.filter((event) => event.kind === "DEEP_ANALYSIS_COMPLETED")).toHaveLength(1);

      const conversation = composition.stores.conversations.get(command.conversation.id);
      expect(conversation?.messageIds).toHaveLength(20);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
