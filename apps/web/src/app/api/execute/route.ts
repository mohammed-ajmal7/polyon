import { isAuthenticated } from "@/server/auth";
import { randomUUID } from "node:crypto";

import { classifyTaskMode, type CommandMode } from "@polyon/application";
import type { BuiltInAgentRoleId } from "@polyon/contracts";

import {
  getPolyonActorId,
  getPolyonComposition,
  getPolyonPolicy,
  isSameOrigin,
} from "@/server/polyon-server";
import { readBoundedText } from "@/server/bounded-body";
import { BackgroundRunLimitError, startBackgroundRun } from "@/server/run-registry";

export const runtime = "nodejs";
export const maxDuration = 300;

const MAX_REQUEST_BYTES = 65_536;

export async function POST(request: Request): Promise<Response> {
  if (!(await isAuthenticated()))
    return Response.json({ error: "Authentication required." }, { status: 401 });
  if (!isSameOrigin(request)) {
    return Response.json({ error: "Cross-origin POST requests are not allowed." }, { status: 403 });
  }
  try {
    if (!process.env.POLYON_EXECUTION_ENABLED || process.env.POLYON_EXECUTION_ENABLED !== "true") {
      return Response.json(
        { error: "Execution is disabled. Set POLYON_EXECUTION_ENABLED=true." },
        { status: 503 },
      );
    }

    const raw = await readBoundedText(request, MAX_REQUEST_BYTES);
    if (raw === undefined) {
      return Response.json(
        { error: "Execution request exceeds the 65536-byte limit." },
        { status: 413 },
      );
    }

    const input = JSON.parse(raw) as Record<string, unknown>;
    const command = parseString(input.command, 50_000, "command");
    const polyon = getPolyonComposition();
    const { mode, modeReason } = resolveMode(input.mode, command, polyon);
    const actorId = getPolyonActorId();
    const targets = resolveTargets(input.agentIds, mode, polyon);
    const participantIds = [actorId, ...targets.map((target) => target.actorId)];

    const commandResult = polyon.commandIngress.submit({
      mode,
      command,
      actorId,
      conversationId: parseOptionalString(input.conversationId) ?? randomUUID(),
      messageId: parseOptionalString(input.messageId) ?? randomUUID(),
      eventId: parseOptionalString(input.eventId) ?? randomUUID(),
      participantIds: [...new Set(participantIds)],
      createdAt: new Date().toISOString(),
    });

    const policy = getPolyonPolicy();
    const requiredCapabilityIds = parseStringArray(input.requiredCapabilityIds, 20);
    const first = targets[0];
    if (first === undefined) throw new ExecuteRequestError("At least one agent is required.");

    if (mode === "Research" && polyon.researchOrchestration === undefined) {
      throw new Error(
        "Research is not configured. Set POLYON_RESEARCH_SEARCH_ENDPOINT and allowed hosts.",
      );
    }

    const work = async (): Promise<unknown> => {
      if (mode === "Direct" || mode === "Broadcast") {
        return polyon.conversationOrchestration.execute({
          command: commandResult,
          targets: mode === "Direct" ? [first] : targets,
          requiredCapabilityIds,
          policy,
          actorId,
          maxToolRounds: parsePositiveInteger(input.maxToolRounds, 8, 100),
          maxToolOutputBytes: parsePositiveInteger(
            input.maxToolOutputBytes,
            64 * 1024,
            2 * 1024 * 1024,
          ),
        });
      }

      if (mode === "Collaborative") {
        return polyon.collectiveOrchestration.execute({
          command: commandResult,
          targets,
          requiredCapabilityIds,
          actorId,
          synthesizerAgentId: parseOptionalString(input.synthesizerAgentId),
          maxParticipants: parsePositiveInteger(input.maxParticipants, 8, 8),
        });
      }

      if (mode === "Research") {
        return polyon.researchOrchestration!.execute({
          command: commandResult,
          targets,
          requiredCapabilityIds,
          actorId,
          synthesizerAgentId: parseOptionalString(input.synthesizerAgentId),
          maxParticipants: parsePositiveInteger(input.maxParticipants, 8, 8),
          sourceLimit: parsePositiveInteger(input.researchSourceLimit, 5, 20),
        });
      }

      if (mode === "DeepAnalysis") {
        const factCheckerAgentId =
          parseOptionalString(input.factCheckerAgentId) ?? agentIdForRole(polyon, "fact-checker");
        return polyon.deepAnalysisOrchestration.execute({
          command: commandResult,
          targets,
          requiredCapabilityIds,
          actorId,
          synthesizerAgentId: parseOptionalString(input.synthesizerAgentId),
          ...(factCheckerAgentId === undefined ? {} : { factCheckerAgentId }),
          maxParticipants: parsePositiveInteger(input.maxParticipants, 8, 8),
          maxChallengeRounds: parseOptionalInteger(input.maxChallengeRounds, 1, 2),
          maxDebateRounds: parsePositiveInteger(input.maxDebateRounds, 2, 4),
        });
      }

      if (mode === "Debate") {
        const debate = polyon.debates.create({
          id: parseOptionalString(input.debateId) ?? randomUUID(),
          objective: command,
          participantAgentIds: targets.map((target) => target.agentId),
          maxParticipants: Math.min(targets.length, 8),
          maxRounds: parsePositiveInteger(input.maxRounds, 2, 6),
          createdAt: new Date().toISOString(),
        });
        return polyon.debates.run({
          debateId: debate.id,
          requiredCapabilityIds,
          adjudicatorAgentId: first.agentId,
          now: () => new Date().toISOString(),
        });
      }

      const now = new Date().toISOString();
      return polyon.missionWorkflow.execute({
        missionId: parseOptionalString(input.missionId) ?? randomUUID(),
        conversationId: commandResult.conversation.id,
        objective: command,
        actorId,
        planningAgentId: first.agentId,
        executionAgentId: first.agentId,
        requiredCapabilityIds,
        policy,
        riskLevel: parseRiskLevel(input.riskLevel),
        proposalId: parseOptionalString(input.proposalId) ?? randomUUID(),
        decisionId: parseOptionalString(input.decisionId) ?? randomUUID(),
        approvalRequestId: parseOptionalString(input.approvalRequestId) ?? randomUUID(),
        createdAt: now,
        planningAt: now,
        identities: {
          executionId: (taskId, attempt) => `execution-${taskId}-${attempt}`,
          policyDecisionId: (taskId, executionId) => `decision-${taskId}-${executionId}`,
          approvalRequestId: (taskId, executionId) => `approval-${taskId}-${executionId}`,
        },
      });
    };

    if (input.async === true && process.env.VERCEL !== "1") {
      // Local/self-hosted runtimes can keep the in-memory background registry alive.
      const run = startBackgroundRun(
        {
          runId: commandResult.conversation.id,
          mode,
          ...(modeReason === undefined ? {} : { modeReason }),
        },
        work,
      );
      return Response.json(
        { runId: run.runId, conversationId: run.runId, mode, modeReason, status: run.status },
        { status: 202 },
      );
    }

    const result = await work();
    return Response.json({ mode, modeReason, result }, { status: 201 });
  } catch (error) {
    if (error instanceof BackgroundRunLimitError) {
      return Response.json({ error: error.message }, { status: 429 });
    }
    if (error instanceof ExecuteRequestError || error instanceof SyntaxError) {
      return Response.json({ error: error.message }, { status: 400 });
    }
    const message = error instanceof Error ? error.message : "Execution request failed.";
    return Response.json(
      { error: message },
      { status: message.startsWith("Research is not configured") ? 503 : 500 },
    );
  }
}

/** A malformed or out-of-bounds request; everything else is a server-side failure. */
class ExecuteRequestError extends Error {}

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

/** Picks the default team by agent role; falls back to registration order without roles. */
function defaultAgentIds(
  mode: CommandMode,
  polyon: ReturnType<typeof getPolyonComposition>,
): readonly string[] {
  const roles = DEFAULT_TEAM_ROLES[mode] ?? [];
  const byRole = roles
    .map((roleId) => agentIdForRole(polyon, roleId))
    .filter((id): id is string => id !== undefined);
  const single = mode === "Direct" || mode === "Mission";
  if (single ? byRole.length >= 1 : byRole.length >= 2) return single ? byRole.slice(0, 1) : byRole;

  const active = polyon.agents
    .list()
    .filter((agent) => agent.status === "ACTIVE")
    .map((agent) => agent.id);
  return single ? active.slice(0, 1) : active.slice(0, 8);
}

/**
 * "Auto" (the default) lets POLYON decide how much of the team a request needs, so the user
 * does not have to choose an orchestration mode.
 */
function resolveMode(
  value: unknown,
  command: string,
  polyon: ReturnType<typeof getPolyonComposition>,
): { mode: CommandMode; modeReason?: string } {
  if (value !== undefined && value !== "Auto") return { mode: parseMode(value) };

  const classification = classifyTaskMode(command);
  if (classification.mode === "simple")
    return { mode: "Direct", modeReason: classification.reason };
  if (classification.mode === "research") {
    return polyon.researchOrchestration === undefined
      ? {
          mode: "Collaborative",
          modeReason:
            classification.reason + " Web research is not configured, so the team answers.",
        }
      : { mode: "Research", modeReason: classification.reason };
  }
  return { mode: "DeepAnalysis", modeReason: classification.reason };
}

function parseMode(value: unknown): CommandMode {
  if (
    value === "Direct" ||
    value === "Broadcast" ||
    value === "Collaborative" ||
    value === "Research" ||
    value === "DeepAnalysis" ||
    value === "Debate" ||
    value === "Mission"
  )
    return value;
  throw new ExecuteRequestError("Invalid command mode.");
}

function parseString(value: unknown, maxLength: number, field: string): string {
  if (typeof value !== "string" || value.trim() === "")
    throw new ExecuteRequestError(field + " must be a non-empty string.");
  if (Array.from(value).length > maxLength)
    throw new ExecuteRequestError(field + " exceeds its " + maxLength + "-character limit.");
  return value.trim();
}

function parseOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

function parsePositiveInteger(value: unknown, fallback: number, max: number): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > max)
    throw new ExecuteRequestError("Integer parameter is outside its allowed bounds.");
  return parsed;
}

function parseOptionalInteger(value: unknown, fallback: number, max: number): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > max)
    throw new ExecuteRequestError("Integer parameter is outside its allowed bounds.");
  return parsed;
}

function parseStringArray(value: unknown, max: number): readonly string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > max)
    throw new ExecuteRequestError("String array exceeds its allowed bound.");
  return value.map((item) => parseString(item, 200, "array item"));
}

function resolveTargets(
  value: unknown,
  mode: CommandMode,
  polyon: ReturnType<typeof getPolyonComposition>,
) {
  let ids: readonly string[];

  if (value === undefined) {
    ids = defaultAgentIds(mode, polyon);
  } else if (Array.isArray(value)) {
    ids = value.map((id) => parseString(id, 200, "agentId"));
  } else {
    throw new ExecuteRequestError("agentIds must be an array.");
  }

  if (ids.length === 0 || ids.length > 8)
    throw new ExecuteRequestError("agentIds must contain between 1 and 8 agents.");
  const unique = [...new Set(ids)];
  return unique.map((agentId) => {
    const agent = polyon.agents.get(agentId);
    if (agent === undefined || agent.status !== "ACTIVE")
      throw new ExecuteRequestError("Requested agent is not active: " + agentId + ".");
    return { agentId, actorId: agentId };
  });
}

function parseRiskLevel(value: unknown): "LOW" | "MEDIUM" | "HIGH" {
  if (value === undefined || value === "LOW") return "LOW";
  if (value === "MEDIUM" || value === "HIGH") return value;
  throw new ExecuteRequestError("riskLevel must be LOW, MEDIUM, or HIGH.");
}
