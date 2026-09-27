export type InteroperabilityProtocol = "MCP" | "A2A" | "ACP";

export interface InteroperabilityEnvelope {
  readonly id: string;
  readonly protocol: InteroperabilityProtocol;
  readonly operation: string;
  readonly source: string;
  readonly target: string;
  readonly correlationId: string;
  readonly payload: unknown;
  readonly createdAt: string;
  readonly idempotencyKey?: string;
}

export interface InteroperabilityAdapter {
  readonly protocol: InteroperabilityProtocol;
  encode(envelope: InteroperabilityEnvelope): Uint8Array;
  decode(payload: Uint8Array): InteroperabilityEnvelope;
}

export function validateInteroperabilityEnvelope(
  envelope: InteroperabilityEnvelope,
  maxPayloadBytes = 256_000,
): void {
  if (
    envelope.id.trim() === "" ||
    envelope.operation.trim() === "" ||
    envelope.source.trim() === "" ||
    envelope.target.trim() === "" ||
    envelope.correlationId.trim() === ""
  ) {
    throw new RangeError("Interoperability envelope identifiers must not be empty.");
  }

  if (!Number.isInteger(maxPayloadBytes) || maxPayloadBytes <= 0 || maxPayloadBytes > 5_000_000) {
    throw new RangeError("Interoperability maxPayloadBytes must be a positive bounded integer.");
  }

  if (!Number.isFinite(Date.parse(envelope.createdAt))) {
    throw new RangeError("Interoperability envelope createdAt must be a valid timestamp.");
  }

  let serializedPayload: string;
  try {
    serializedPayload = JSON.stringify(envelope.payload);
  } catch {
    throw new RangeError("Interoperability envelope payload must be JSON-serializable.");
  }
  if (serializedPayload === undefined) {
    throw new RangeError("Interoperability envelope payload must not be undefined.");
  }
  const payload = new TextEncoder().encode(serializedPayload);
  if (payload.byteLength > maxPayloadBytes) {
    throw new RangeError("Interoperability envelope payload exceeds the configured byte limit.");
  }
}
