import { randomUUID } from "node:crypto";
import type { CommandMode } from "@polyon/application";
import { getPolyonActorId, getPolyonComposition, isSameOrigin } from "@/server/polyon-server";

export const runtime = "nodejs";
const MAX_REQUEST_BYTES = 65_536;

export async function POST(request: Request): Promise<Response> {
  if (!isSameOrigin(request)) {
    return Response.json({ error: "Cross-origin POST requests are not allowed." }, { status: 403 });
  }
  try {
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > MAX_REQUEST_BYTES) {
      return Response.json({ error: "Command request exceeds the 65536-byte limit." }, { status: 413 });
    }
    const input = JSON.parse(raw) as Record<string, unknown>;
    const actorId = getPolyonActorId();
    const mode = parseMode(input.mode);
    const command = parseBoundedString(input.command, 50_000, "command");
    const result = getPolyonComposition().commandIngress.submit({
      mode,
      command,
      actorId,
      conversationId: parseOptionalString(input.conversationId) ?? randomUUID(),
      messageId: parseOptionalString(input.messageId) ?? randomUUID(),
      eventId: parseOptionalString(input.eventId) ?? randomUUID(),
      participantIds: parseParticipantIds(input.participantIds, actorId),
      ...(parseOptionalString(input.missionId) === undefined
        ? {}
        : { missionId: parseOptionalString(input.missionId) }),
      createdAt: new Date().toISOString(),
    });
    return Response.json(result, { status: 201 });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Command request failed." },
      { status: 400 },
    );
  }
}

function parseMode(value: unknown): CommandMode {
  if (value === "Direct" || value === "Broadcast" || value === "Debate" || value === "Mission") {
    return value;
  }
  throw new Error("Invalid command mode.");
}

function parseBoundedString(value: unknown, maxLength: number, field: string): string {
  if (typeof value !== "string" || value.trim() === "") throw new Error(field + " must be a non-empty string.");
  if (Array.from(value).length > maxLength) throw new Error(field + " exceeds its " + maxLength + "-character limit.");
  return value;
}

function parseOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

function parseParticipantIds(value: unknown, actorId: string): readonly string[] {
  if (value === undefined) return [actorId];
  if (!Array.isArray(value) || value.length === 0 || value.length > 20) {
    throw new Error("participantIds must contain between 1 and 20 ids.");
  }
  const ids = value.map((candidate) => {
    if (typeof candidate !== "string" || candidate.trim() === "") throw new Error("participantIds must contain non-empty strings.");
    return candidate.trim();
  });
  if (!ids.includes(actorId)) ids.push(actorId);
  return [...new Set(ids)];
}