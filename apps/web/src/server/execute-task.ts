import { randomUUID } from "node:crypto";

import type { BuiltInAgentRoleId } from "@polyon/contracts";
import type { CommandMode } from "@polyon/application";

import {
  getPolyonActorId,
  getPolyonComposition,
  getPolyonPolicy,
} from "@/server/polyon-server";

export interface ExecuteTaskInput {
  readonly runId: string;
  readonly mode: CommandMode;
  readonly modeReason?: string;
  readonly command: string;
  readonly messageId: string;
  readonly eventId: string;
  readonly requiredCapabilityIds: readonly string[];
  readonly agentIds: readonly string[];
  readonly maxToolRounds: number;
  readonly maxToolOutputBytes: number;
  readonly synthesizerAgentId?: string;
  readonly maxParticipants: number;
  readonly researchSourceLimit: number;
  readonly factCheckerAgentId?: string;
  readonly maxChallengeRounds: number;
  readonly maxDebateRounds: number;
  readonly debateId?: string;
  readonly maxRounds: number;
  readonly missionId?: string;
  readonly riskLevel: "LOW" | "MEDIUM" | "HIGH";
  readonly proposalId?: string;
  readonly decisionId?: string;
  readonly approvalRequestId?: string;
}

export async function executePolyonTask(input: ExecuteTaskInput): Promise<unknown> {
  const polyon = getPolyonComposition();
  const actorId = getPolyonActorId();
  const targets = resolveTargets(input.agentIds, polyon);
  const participantIds = [actorId, ...targets.map((target) => target.actorId)];

  const commandResult = polyon.commandIngress.submit({
    mode: input.mode,
    command: input.command,
    actorId,
    conversationId: input.runId,
    messageId: input.messageId,
    eventId: input.eventId,
    participantIds: [...new Set(participantIds)],
    createdAt: new Date().toISOString(),
  });

  const policy = getPolyonPolicy();
  const first = targets[0];
  if (first === undefined) throw new Error("At least one agent is required.");

  if (input.mode === "Research" && polyon.researchOrchestration === undefined) {
    throw new Error(
      "Research is not configured. Set POLYON_RESEARCH_SEARCH_ENDPOINT and allowed hosts.",
    );
  }

  let result: unknown;

  if (input.mode === "Direct" || input.mode === "Broadcast") {
    result = await polyon.conversationOrchestration.execute({
      command: commandResult,
      targets: input.mode === "Direct" ? [first] : targets,
      requiredCapabilityIds: input.requiredCapabilityIds,
      policy,
      actorId,
      maxToolRounds: input.maxToolRounds,
      maxToolOutputBytes: input.maxToolOutputBytes,
    });
  } else if (input.mode === "Collaborative") {
    result = await polyon.collectiveOrchestration.execute({
      command: commandResult,
      targets,
      requiredCapabilityIds: input.requiredCapabilityIds,
      actorId,
      synthesizerAgentId: input.synthesizerAgentId,
      maxParticipants: input.maxParticipants,
    });
  } else if (input.mode === "Research") {
    result = await polyon.researchOrchestration!.execute({
      command: commandResult,
      targets,
      requiredCapabilityIds: input.requiredCapabilityIds,
      actorId,
      synthesizerAgentId: input.synthesizerAgentId,
      maxParticipants: input.maxParticipants,
      sourceLimit: input.researchSourceLimit,
    });
  } else if (input.mode === "DeepAnalysis") {
    const factCheckerAgentId =
      input.factCheckerAgentId ?? agentIdForRole(polyon, "fact-checker");

    result = await polyon.deepAnalysisOrchestration.execute({
      command: commandResult,
      targets,
      requiredCapabilityIds: input.requiredCapabilityIds,
      actorId,
      synthesizerAgentId: input.synthesizerAgentId,
      ...(factCheckerAgentId === undefined ? {} : { factCheckerAgentId }),
      maxParticipants: input.maxParticipants,
      maxChallengeRounds: input.maxChallengeRounds,
      maxDebateRounds: input.maxDebateRounds,
    });
  } else if (input.mode === "Debate") {
    const debate = polyon.debates.create({
      id: input.debateId ?? randomUUID(),
      objective: input.command,
      participantAgentIds: targets.map((target) => target.agentId),
      maxParticipants: Math.min(targets.length, 8),
      maxRounds: input.maxRounds,
      createdAt: new Date().toISOString(),
    });

    result = await polyon.debates.run({
      debateId: debate.id,
      requiredCapabilityIds: input.requiredCapabilityIds,
      adjudicatorAgentId: first.agentId,
      now: () => new Date().toISOString(),
    });
  } else {
    const now = new Date().toISOString();
    result = await polyon.missionWorkflow.execute({
      missionId: input.missionId ?? randomUUID(),
      conversationId: commandResult.conversation.id,
      objective: input.command,
      actorId,
      planningAgentId: first.agentId,
      executionAgentId: first.agentId,
      requiredCapabilityIds: input.requiredCapabilityIds,
      policy,
      riskLevel: input.riskLevel,
      proposalId: input.proposalId ?? randomUUID(),
      decisionId: input.decisionId ?? randomUUID(),
      approvalRequestId: input.approvalRequestId ?? randomUUID(),
      createdAt: now,
      planningAt: now,
      identities: {
        executionId: (taskId, attempt) => `execution-${taskId}-${attempt}`,
        policyDecisionId: (taskId, executionId) => `decision-${taskId}-${executionId}`,
        approvalRequestId: (taskId, executionId) => `approval-${taskId}-${executionId}`,
      },
    });
  }

  await persistConversationHistory(commandResult.conversation.id);
  return result;
}

const DEFAULT_TEAM_ROLES: Partial<Record<CommandMode, readonly BuiltInAgentRoleId[]>> = {
  Direct: ["action-agent", "synthesizer"],
  Broadcast: ["researcher", "analyst", "specialist"],
  Collaborative: ["researcher", "analyst", "specialist", "critic", "synthesizer"],
  Research: ["researcher", "analyst", "synthesizer"],
  DeepAnalysis: ["researcher", "analyst", "critic", "judge"],
  Debate: ["analyst", "critic", "judge"],
  Mission: ["planner"],
};

function agentIdForRole(
  polyon: ReturnType<typeof getPolyonComposition>,
  roleId: BuiltInAgentRoleId,
): string | undefined {
  return polyon.agents.list().find((agent) => agent.status === "ACTIVE" && agent.roleId === roleId)
    ?.id;
}

function resolveTargets(
  ids: readonly string[],
  polyon: ReturnType<typeof getPolyonComposition>,
) {
  if (ids.length === 0 || ids.length > 8) {
    throw new Error("agentIds must contain between 1 and 8 agents.");
  }

  return [...new Set(ids)].map((agentId) => {
    const agent = polyon.agents.get(agentId);
    if (agent === undefined || agent.status !== "ACTIVE") {
      throw new Error("Requested agent is not active: " + agentId + ".");
    }
    return { agentId, actorId: agentId };
  });
}

export { DEFAULT_TEAM_ROLES, agentIdForRole };
