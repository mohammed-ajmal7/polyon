import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Agent, Model, Provider, TextModelRequest } from "@polyon/contracts";
import type {
  ModelInvocationResult,
  TextModelProviderAdapter,
  ProviderInvocationRequest,
} from "@polyon/providers";
import { describe, expect, it } from "vitest";

import { createPolyonComposition, type PolyonProviderRegistration } from "./polyon-composition";

const now = "2026-09-29T08:00:00.000Z";

function makeAgent(
  agentId: string,
  modelId: string,
  role: string,
  providerId: string,
): Agent {
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

function makeProvider(
  providerId: string,
  invocations: Array<ProviderInvocationRequest<TextModelRequest>>,
): PolyonProviderRegistration {
  const provider: Provider = {
    id: providerId,
    name: providerId + " provider",
    kind: "HOSTED_MODEL",
    enabled: true,
  };

  const adapter: TextModelProviderAdapter = {
    providerId,
    async invoke(request) {
      invocations.push(request);

      const userMessage =
        request.input.messages.find((message) => message.role === "USER")?.content ?? "";
      const sourceId = userMessage.match(/\\[source:([^\\]\\s]+)/u)?.[1] ?? "source-missing";

      let content = `${request.modelId} produced an evidence-aware finding. [source:${sourceId}]`;

      if (userMessage.includes("Return the strongest challenges")) {
        content = `${request.modelId} identified an unsupported assumption and a competing explanation. [source:${sourceId}]`;
      } else if (userMessage.includes("Format the response with these sections")) {
        content =
          "Findings\\nThe team has independent evidence.\\nEvidence\\n" +
          `[source:${sourceId}]\\nAgreements\\nSupported signals overlap.\\n` +
          "Disagreements\\nInterpretations remain distinct.\\nCounterclaims\\nAlternative explanations remain possible.\\n" +
          "Uncertainty\\nThe retrieved evidence is bounded.\\nConclusion\\nUse the source-backed signals with explicit caveats.";
      }

      return {
        output: {
          content,
        },
      };
    },
  };

  return { provider, adapter };
}

describe("POLYON minimum source-backed deep-analysis flow", () => {
  it("runs research, independent agents, critic challenges, adjudication, and a traceable final answer", async () => {
    const root = mkdtempSync(join(tmpdir(), "polyon-source-backed-e2e-"));
    const invocations: Array<ProviderInvocationRequest<TextModelRequest>> = [];
    const searchQueries: string[] = [];

    try {
      const provider = makeProvider("provider.shared", invocations);
      const agents = [
        makeAgent("research-a", "model.research-a", "Company research specialist", provider.provider.id),
        makeAgent("research-b", "model.research-b", "Market research specialist", provider.provider.id),
        makeAgent("critic", "model.critic", "Critical research reviewer", provider.provider.id),
        makeAgent("judge", "model.judge", "Judging and synthesis lead", provider.provider.id),
      ];
      const models = [
        makeModel("model.research-a", provider.provider.id),
        makeModel("model.research-b", provider.provider.id),
        makeModel("model.critic", provider.provider.id),
        makeModel("model.judge", provider.provider.id),
      ];

      const composition = createPolyonComposition({
        storageRoot: root,
        providers: [provider],
        models,
        agents,
        researchRetriever: {
          search: async (query, options) => {
            expect(options.limit).toBe(1);
            searchQueries.push(query);
            const sourceKey = query.toLowerCase().includes("company")
              ? "company"
              : query.toLowerCase().includes("market")
                ? "market"
                : query.toLowerCase().includes("critical")
                  ? "critical"
                  : "other";

            return [
              {
                title: sourceKey.toUpperCase() + " source",
                locator: "https://example.test/" + sourceKey,
                kind: "WEB",
                content: "Verified fixture evidence for " + sourceKey + ".",
                claim: "Fixture evidence supports the investigation.",
                retrievedAt: now,
              },
            ];
          },
        },
      });

      const command = composition.commandIngress.submit({
        mode: "DeepAnalysis",
        command: "Investigate the strongest explanations for this incident and verify the evidence.",
        actorId: "user.e2e",
        conversationId: "conversation.source-backed-e2e",
        messageId: "message.source-backed-e2e",
        eventId: "event.source-backed-e2e",
        participantIds: ["user.e2e", ...agents.map((agent) => agent.id)],
        createdAt: now,
      });

      const result = await composition.deepAnalysisOrchestration.execute({
        command,
        targets: agents.map((agent) => ({
          agentId: agent.id,
          actorId: agent.id,
        })),
        actorId: "user.e2e",
        requiredCapabilityIds: [],
        synthesizerAgentId: "judge",
        maxParticipants: 4,
        maxChallengeRounds: 1,
        maxDebateRounds: 1,
        researchEnabled: true,
        researchSourceLimit: 1,
        now: () => now,
      });

      expect(result.status).toBe("SUCCEEDED");
      expect(result.collective.status).toBe("SUCCEEDED");
      expect(result.collective.contributions).toHaveLength(3);
      expect(new Set(result.collective.contributions.map((item) => item.agentId))).toEqual(
        new Set(["research-a", "research-b", "critic"]),
      );
      expect(result.collective.sourceIds.length).toBe(3);
      expect(result.collective.evidenceIds.length).toBe(3);
      expect(result.collective.challenges).toHaveLength(3);
      expect(result.debate?.debate.status).toBe("DECIDED");
      expect(result.decision?.actorId).toBe("judge");
      expect(result.decision?.content).toContain("[source:");

      expect(searchQueries).toHaveLength(3);
      expect(new Set(searchQueries.map((query) => query.split("\\n\\nResearch focus: ")[0]))).toEqual(
        new Set([
          "Investigate the strongest explanations for this incident and verify the evidence.",
        ]),
      );

      const events = composition.stores.events.list();
      expect(events.filter((event) => event.kind === "SOURCE_RETRIEVED")).toHaveLength(3);
      expect(events.filter((event) => event.kind === "EVIDENCE_CAPTURED")).toHaveLength(3);
      expect(events.filter((event) => event.kind === "COLLECTIVE_CONTRIBUTION")).toHaveLength(3);
      expect(events.filter((event) => event.kind === "COLLECTIVE_CHALLENGE")).toHaveLength(3);
      expect(events.filter((event) => event.kind === "DEBATE_DECIDED")).toHaveLength(1);
      expect(events.filter((event) => event.kind === "DEEP_ANALYSIS_COMPLETED")).toHaveLength(1);

      const evidence = composition.stores.evidence.list();
      expect(evidence).toHaveLength(3);
      expect(evidence.every((item) => item.taskId === result.collective.collectiveId)).toBe(true);

      const evidenceBackedCall = invocations.find((request) =>
        request.input.messages.some(
          (message) =>
            message.role === "USER" &&
            message.content.includes("Verified fixture evidence"),
        ),
      );
      expect(evidenceBackedCall).toBeDefined();

      const agentIds = new Set(
        invocations.map((request) => {
          if (request.modelId === "model.research-a") return "research-a";
          if (request.modelId === "model.research-b") return "research-b";
          if (request.modelId === "model.critic") return "critic";
          return "judge";
        }),
      );
      expect(agentIds).toEqual(new Set(["research-a", "research-b", "critic", "judge"]));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
