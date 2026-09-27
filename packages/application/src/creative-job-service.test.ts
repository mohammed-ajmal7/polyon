import {
  validateInteroperabilityEnvelope,
  type InteroperabilityAdapter,
  type InteroperabilityEnvelope,
  type InteroperabilityProtocol,
} from "./envelope";

export class JsonInteroperabilityAdapter implements InteroperabilityAdapter {
  constructor(
    readonly protocol: InteroperabilityProtocol,
    private readonly maxPayloadBytes = 256_000,
  ) {}

  encode(envelope: InteroperabilityEnvelope): Uint8Array {
    validateInteroperabilityEnvelope(envelope, this.maxPayloadBytes);
    return new TextEncoder().encode(JSON.stringify(envelope));
  }

  decode(payload: Uint8Array): InteroperabilityEnvelope {
    if (payload.byteLength > this.maxPayloadBytes + 2_000) {
      throw new RangeError("Interoperability payload exceeds the configured byte limit.");
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(new TextDecoder().decode(payload));
    } catch {
      throw new RangeError("Interoperability payload is not valid JSON.");
    }

    if (parsed === null || typeof parsed !== "object") {
      throw new RangeError("Interoperability payload must be an envelope object.");
    }

    const envelope = parsed as InteroperabilityEnvelope;
    if (envelope.protocol !== this.protocol) {
      throw new RangeError("Interoperability envelope protocol does not match the adapter.");
    }
    validateInteroperabilityEnvelope(envelope, this.maxPayloadBytes);
    return envelope;
  }
}

