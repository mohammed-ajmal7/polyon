import { describe, expect, it } from "vitest";

import {
  JsonInteroperabilityAdapter,
} from "@polyon/contracts";

describe("JsonInteroperabilityAdapter", () => {
  it("round-trips bounded envelopes for MCP, A2A, and ACP", () => {
    for (const protocol of ["MCP", "A2A", "ACP"] as const) {
      const adapter = new JsonInteroperabilityAdapter(protocol);
      const envelope = {
        id: "message-1",
        protocol,
        operation: "PING",
        source: "polyon",
        target: "peer",
        correlationId: "corr-1",
        payload: { bounded: true },
        createdAt: "2026-09-28T00:00:00.000Z",
      };
      expect(adapter.decode(adapter.encode(envelope))).toEqual(envelope);
    }
  });

  it("rejects protocol mismatches", () => {
    const adapter = new JsonInteroperabilityAdapter("MCP");
    const payload = new TextEncoder().encode(JSON.stringify({
      id: "1",
      protocol: "A2A",
      operation: "PING",
      source: "a",
      target: "b",
      correlationId: "c",
      payload: {},
      createdAt: "2026-09-28T00:00:00.000Z",
    }));
    expect(() => adapter.decode(payload)).toThrow("protocol does not match");
  });
});
