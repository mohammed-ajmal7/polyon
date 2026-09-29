import type { Evidence, Finding, FindingDisposition } from "@polyon/contracts";
import { createFinding } from "@polyon/core";

export interface ParseStructuredFindingInput {
  readonly id: string;
  readonly agentId: string;
  readonly content: string;
  readonly evidence: readonly Evidence[];
  readonly createdAt: string;
}

export function parseStructuredFinding(
  input: ParseStructuredFindingInput,
): Finding | undefined {
  const object = extractObject(input.content);
  if (object === undefined) return undefined;

  const claim = stringField(object.claim);
  const confidence = numberField(object.confidence);
  const disposition = dispositionField(object.disposition);
  const assumptions = stringList(object.assumptions);
  const counterarguments = stringList(object.counterarguments);
  const evidenceIds = stringList(object.evidenceIds);

  if (
    claim === undefined ||
    confidence === undefined ||
    disposition === undefined ||
    assumptions === undefined ||
    counterarguments === undefined ||
    evidenceIds === undefined
  ) {
    return undefined;
  }

  const evidenceById = new Map(input.evidence.map((item) => [item.id, item]));
  const evidence = evidenceIds
    .map((id) => evidenceById.get(id))
    .filter((item): item is Evidence => item !== undefined)
    .map((item) => ({
      evidenceId: item.id,
      sourceId: item.sourceId,
    }));

  if (evidence.length !== evidenceIds.length) return undefined;

  try {
    return createFinding({
      id: input.id,
      agentId: input.agentId,
      claim,
      evidence,
      confidence,
      assumptions,
      counterarguments,
      disposition,
      createdAt: input.createdAt,
    });
  } catch {
    return undefined;
  }
}

function extractObject(content: string): Record<string, unknown> | undefined {
  const start = content.indexOf("{");
  const end = content.lastIndexOf("}");
  if (start < 0 || end <= start) return undefined;

  try {
    const value: unknown = JSON.parse(content.slice(start, end + 1));
    return value !== null && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

function stringField(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

function numberField(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function stringList(value: unknown): readonly string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  if (!value.every((item) => typeof item === "string")) return undefined;
  return value.map((item) => item.trim()).filter(Boolean);
}

function dispositionField(value: unknown): FindingDisposition | undefined {
  if (value === "SUPPORTED" || value === "CONTRADICTED" || value === "UNRESOLVED" || value === "INFERRED") {
    return value;
  }
  return undefined;
}