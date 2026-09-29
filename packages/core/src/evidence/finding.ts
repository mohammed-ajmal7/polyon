import type { Finding, FindingDisposition, FindingEvidenceRef } from "@polyon/contracts";

export interface CreateFindingInput {
  readonly id: string;
  readonly agentId: string;
  readonly claim: string;
  readonly evidence?: readonly FindingEvidenceRef[];
  readonly confidence: number;
  readonly assumptions?: readonly string[];
  readonly counterarguments?: readonly string[];
  readonly disposition: FindingDisposition;
  readonly createdAt: string;
}

export function createFinding(input: CreateFindingInput): Finding {
  const id = input.id.trim();
  const agentId = input.agentId.trim();
  const claim = input.claim.trim();

  if (id === "") throw new RangeError("Finding id must not be empty.");
  if (agentId === "") throw new RangeError("Finding agentId must not be empty.");
  if (claim === "") throw new RangeError("Finding claim must not be empty.");
  if (!Number.isFinite(input.confidence) || input.confidence < 0 || input.confidence > 1) {
    throw new RangeError("Finding confidence must be a number between 0 and 1.");
  }

  return {
    id,
    agentId,
    claim,
    evidence: [...(input.evidence ?? [])],
    confidence: input.confidence,
    assumptions: [...(input.assumptions ?? [])].map((item) => item.trim()).filter(Boolean),
    counterarguments: [...(input.counterarguments ?? [])]
      .map((item) => item.trim())
      .filter(Boolean),
    disposition: input.disposition,
    createdAt: input.createdAt,
  };
}