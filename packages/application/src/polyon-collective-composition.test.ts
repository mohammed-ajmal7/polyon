import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Agent, Model, Provider } from "@polyon/contracts";
import type { TextModelProviderAdapter } from "@polyon/providers";
import { describe, expect, it } from "vitest";

import { createPolyonComposition, type PolyonProviderRegistration } from "./polyon-composition";

const now = "2026-09-28T18:30:00.000Z";

function makeProvider(): PolyonProviderRegistration {
  const provider: Provider = {
    id: "collective.test-provider",
    name: "Collective test provider",
    kind: "HOSTED_MODEL",
    enabled: true,
  };

  const adapter: TextModelProviderAdapter = {
    providerId: provider.id,
    async invoke({ modelId }) {
      if (modelId === "model.synthesizer") {
        return {
          output: {
            content:
              "Findings: each specialist contributed a distinct view. " +
              "Evidence: the contribution and challenge trace is attributable. " +
              "Agreements: the team examined the same request. " +
              "Disagreements: specialists emphasized different risks. " +
              "Counterclaims: each challenge tested another perspective. " +
              "Uncertainty: this integration test does not establish real-world truth. " +
              "Conclusion: the collective pipeline completed successfully.",
          },
        };
      }

      if (modelId.includes("researcher")) {
        return {
          output: {
            content: "Researcher finding: identify the strongest factual signals.",
          },
        };
      }

      if (modelId.includes("analyst")) {
        return {
          output: {
            content: "Analyst finding: compare competing explanations and trade-offs.",
          },
        };
      }

      return {
        output: {
          content: "Skeptic finding: challenge unsupported assumptions and uncertainty.",
        },
      };
    },
  };

  return { provider, adapter };
}

function makeAgent(agentId: string, modelId: string, role: string): Agent {
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

function makeModel(modelId: string): Model {
  return {
    id: modelId,
    name: modelId,
    kind: "TEXT",
    providerId: "collective.test-provider",
    capabilityIds: [],
    enabled: true,
  };
}

describe("POLYON collective composition", () => {
  it("runs one user command through four routed models and persists the full collaboration trace", async () => {
    const root = mkdtempSync(join(tmpdir(), "polyon-collective-composition-"));

    try {
      const agents = [
        makeAgent("researcher", "model.researcher", "Researcher"),
        makeAgent("analyst", "model.analyst", "Analyst"),
        makeAgent("skeptic", "model.skeptic", "Skeptic"),
        makeAgent("synthesizer", "model.synthesizer", "Synthesizer"),
      ];
      const models = agents.map((agent) => makeModel(agent.preferredModelId!));

      const composition = createPolyonComposition({
        storageRoot: root,
        providers: [makeProvider()],
        models,
        agents,
      });

      const command = composition.commandIngress.submit({
        mode: "Collaborative",
        command: "Investigate a technical incident and challenge the strongest explanations.",
        actorId: "user.test",
        conversationId: "conversation.collective.integration",
        messageId: "message.collective.integration",
        eventId: "event.collective.integration",
        participantIds: ["user.test", ...agents.map((agent) => agent.id)],
        createdAt: now,
      });

      const result = await composition.collectiveOrchestration.execute({
        command,
        targets: agents.map((agent) => ({ agentId: agent.id, actorId: agent.id })),
        actorId: "user.test",
        requiredCapabilityIds: [],
        synthesizerAgentId: "synthesizer",
        maxParticipants: 8,
        maxChallengeRounds: 1,
        now: () => now,
      });

      // The synthesizer participates in challenges and synthesis, but is not a contributor.
      expect(result.status).toBe("SUCCEEDED");
      expect(result.runId).toBe(result.collectiveId);
      expect(composition.agentRuns.get(result.runId)).toMatchObject({
        status: "completed",
        agentIds: agents.map((agent) => agent.id),
        finalAnswer: result.synthesis?.content,
      });
      expect(result.contributions.map((item) => item.agentId)).toEqual([
        "researcher",
        "analyst",
        "skeptic",
      ]);
      expect(result.contributions.map((item) => item.modelId)).toEqual([
        "model.researcher",
        "model.analyst",
        "model.skeptic",
      ]);
      expect(result.challenges).toHaveLength(4);
      expect(result.synthesis?.actorId).toBe("synthesizer");
      expect(result.synthesis?.content).toContain("Conclusion:");

      const conversation = composition.stores.conversations.get(command.conversation.id);
      expect(conversation?.messageIds).toHaveLength(9);

      expect(
        composition.stores.events
          .list()
          .filter((event) => event.kind === "COLLECTIVE_CONTRIBUTION"),
      ).toHaveLength(3);
      expect(
        composition.stores.events.list().filter((event) => event.kind === "COLLECTIVE_CHALLENGE"),
      ).toHaveLength(4);
      expect(
        composition.stores.events.list().filter((event) => event.kind === "COLLECTIVE_SYNTHESIZED"),
      ).toHaveLength(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });


  it("forms a bounded team automatically when collective targets are omitted", async () => {
    const root = mkdtempSync(join(tmpdir(), "polyon-collective-planner-"));

    try {
      const agents = [
        makeAgent("researcher", "model.researcher", "Researcher"),
        makeAgent("analyst", "model.analyst", "Analyst"),
        makeAgent("skeptic", "model.skeptic", "Skeptic"),
        makeAgent("synthesizer", "model.synthesizer", "Synthesizer"),
      ];
      const models = agents.map((agent) => makeModel(agent.preferredModelId!));
      const composition = createPolyonComposition({
        storageRoot: root,
        providers: [makeProvider()],
        models,
        agents,
      });

      const command = composition.commandIngress.submit({
        mode: "Collaborative",
        command: "Assemble the appropriate team and investigate the incident.",
        actorId: "user.test",
        conversationId: "conversation.collective.planner",
        messageId: "message.collective.planner",
        eventId: "event.collective.planner",
        participantIds: ["user.test"],
        createdAt: now,
      });

      const result = await composition.collectiveOrchestration.execute({
        command,
        actorId: "user.test",
        requiredCapabilityIds: [],
        maxParticipants: 4,
        maxChallengeRounds: 0,
        now: () => now,
      });

      expect(result.status).toBe("SUCCEEDED");
      expect(result.synthesizerAgentId).toBe("synthesizer");
      expect(result.contributions.map((item) => item.agentId)).toEqual([
        "analyst",
        "researcher",
        "skeptic",
      ]);

      const started = composition.stores.events.list().find(
        (event) => event.kind === "COLLECTIVE_STARTED",
      );
      expect(started?.data.participantAgentIds).toEqual([
        "analyst",
        "researcher",
        "skeptic",
        "synthesizer",
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
