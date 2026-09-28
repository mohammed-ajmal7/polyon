import { isAuthenticated } from "@/server/auth";
import { randomUUID } from "node:crypto";

import type { CommandMode } from "@polyon/application";

import {
  getPolyonActorId,
  getPolyonComposition,
  getPolyonPolicy,
  isSameOrigin,
} from "@/server/polyon-server";

export const runtime = "nodejs";

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

    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > MAX_REQUEST_BYTES) {
      return Response.json(
        { error: "Execution request exceeds the 65536-byte limit." },
        { status: 413 },
      );
    }

    const input = JSON.parse(raw) as Record<string, unknown>;
    const mode = parseMode(input.mode);
    const command = parseString(input.command, 50_000, "command");
    const polyon = getPolyonComposition();
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
    if (first === undefined) throw new Error("At least one agent is required.");

    if (mode === "Direct" || mode === "Broadcast") {
      const result = await polyon.conversationOrchestration.execute({
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
      return Response.json({ mode, result }, { status: 201 });
    }

    if (mode === "Collaborative") {
      const result = await polyon.collectiveOrchestration.execute({
        command: commandResult,
        targets,
        requiredCapabilityIds,
        actorId,
        synthesizerAgentId: parseOptionalString(input.synthesizerAgentId),
        maxParticipants: parsePositiveInteger(input.maxParticipants, 8, 8),
      });
      return Response.json({ mode, result }, { status: 201 });
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
      const result = await polyon.debates.run({
        debateId: debate.id,
        requiredCapabilityIds,
        adjudicatorAgentId: first.agentId,
        now: () => new Date().toISOString(),
      });
      return Response.json({ mode, result }, { status: 201 });
    }

    const now = new Date().toISOString();
    const result = await polyon.missionWorkflow.execute({
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

    return Response.json({ mode, result }, { status: 201 });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Execution request failed." },
      { status: 400 },
    );
  }
}

function parseMode(value: unknown): CommandMode {
  if (value === "Direct" || value === "Broadcast" || value === "Debate" || value === "Mission")
    return value;
  throw new Error("Invalid command mode.");
}

function parseString(value: unknown, maxLength: number, field: string): string {
  if (typeof value !== "string" || value.trim() === "")
    throw new Error(field + " must be a non-empty string.");
  if (Array.from(value).length > maxLength)
    throw new Error(field + " exceeds its " + maxLength + "-character limit.");
  return value.trim();
}

function parseOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

function parsePositiveInteger(value: unknown, fallback: number, max: number): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > max)
    throw new Error("Integer parameter is outside its allowed bounds.");
  return parsed;
}

function parseStringArray(value: unknown, max: number): readonly string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > max)
    throw new Error("String array exceeds its allowed bound.");
  return value.map((item) => parseString(item, 200, "array item"));
}

function resolveTargets(
  value: unknown,
  mode: CommandMode,
  polyon: ReturnType<typeof getPolyonComposition>,
) {
  const ids =
    value === undefined
      ? mode === "Collaborative"
        ? polyon.agents.list().slice(0, 8).map((agent) => agent.id)
        : [polyon.agents.list()[0]?.id].filter((id): id is string => id !== undefined)
      : Array.isArray(value)
        ? value.map((id) => parseString(id, 200, "agentId"))
        : (() => {
            throw new Error("agentIds must be an array.");
          })();

  if (ids.length === 0 || ids.length > 8)
    throw new Error("agentIds must contain between 1 and 8 agents.");
  const unique = [...new Set(ids)];
  return unique.map((agentId) => {
    const agent = polyon.agents.get(agentId);
    if (agent === undefined || agent.status !== "ACTIVE")
      throw new Error("Requested agent is not active: " + agentId + ".");
    return { agentId, actorId: agentId };
  });
}

function parseRiskLevel(value: unknown): "LOW" | "MEDIUM" | "HIGH" {
  if (value === undefined || value === "LOW") return "LOW";
  if (value === "MEDIUM" || value === "HIGH") return value;
  throw new Error("riskLevel must be LOW, MEDIUM, or HIGH.");
}
