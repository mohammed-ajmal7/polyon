import { describe, expect, it } from "vitest";

import {
  DebateValidationError,
  validateDebateDefinition,
} from "./debate-validation";

const valid = {
  objective: "Compare approaches.",
  participantAgentIds: ["agent-a", "agent-b"],
  maxParticipants: 2,
  maxRounds: 1,
};

describe("validateDebateDefinition", () => {
  it("accepts a valid bounded definition", () => {
    expect(() => validateDebateDefinition(valid)).not.toThrow();
  });

  it("rejects fewer than two participants", () => {
    expect(() =>
      validateDebateDefinition({
        ...valid,
        participantAgentIds: ["agent-a"],
      }),
    ).toThrowError(
      new DebateValidationError(
        "PARTICIPANTS_BELOW_MINIMUM",
        "A debate requires at least two participants.",
      ),
    );
  });

  it("rejects duplicate participants", () => {
    expect(() =>
      validateDebateDefinition({
        ...valid,
        participantAgentIds: ["agent-a", "agent-a"],
      }),
    ).toThrow(DebateValidationError);
  });

  it("rejects too many participants", () => {
    expect(() =>
      validateDebateDefinition({
        ...valid,
        participantAgentIds: ["agent-a", "agent-b", "agent-c"],
      }),
    ).toThrow(DebateValidationError);
  });

  it("rejects invalid round limits", () => {
    expect(() =>
      validateDebateDefinition({
        ...valid,
        maxRounds: 0,
      }),
    ).toThrow(DebateValidationError);
  });

  it("rejects invalid participant limits", () => {
    expect(() =>
      validateDebateDefinition({
        ...valid,
        maxParticipants: 1,
      }),
    ).toThrow(DebateValidationError);
  });
});
