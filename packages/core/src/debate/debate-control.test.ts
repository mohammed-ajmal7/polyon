import type { Debate } from "@polyon/contracts";
import { describe, expect, it } from "vitest";

import {
  advanceDebatePhase,
  cancelDebate,
  createDebate,
  decideDebate,
  startDebate,
} from "./debate-control";
import { DebateControlError } from "./debate-control";

const create = (): Debate =>
  createDebate({
    id: "debate-1",
    objective: "Compare approaches.",
    participantAgentIds: ["agent-a", "agent-b"],
    maxParticipants: 3,
    maxRounds: 2,
    createdAt: "2026-09-27T01:00:00.000Z",
  });

describe("debate control", () => {
  it("creates a bounded draft", () => {
    expect(create()).toEqual({
      id: "debate-1",
      objective: "Compare approaches.",
      participantAgentIds: ["agent-a", "agent-b"],
      maxParticipants: 3,
      maxRounds: 2,
      currentRound: 0,
      phase: "PROPOSAL",
      status: "DRAFT",
      createdAt: "2026-09-27T01:00:00.000Z",
      updatedAt: "2026-09-27T01:00:00.000Z",
    });
  });

  it("starts at proposal round one", () => {
    expect(startDebate(create(), "2026-09-27T01:01:00.000Z")).toMatchObject({
      status: "RUNNING",
      phase: "PROPOSAL",
      currentRound: 1,
    });
  });

  it("advances the finite debate protocol", () => {
    let debate = startDebate(create(), "2026-09-27T01:01:00.000Z");

    debate = advanceDebatePhase(debate, "2026-09-27T01:02:00.000Z");
    expect(debate.phase).toBe("CRITICISM");

    debate = advanceDebatePhase(debate, "2026-09-27T01:03:00.000Z");
    expect(debate.phase).toBe("EVIDENCE");

    debate = advanceDebatePhase(debate, "2026-09-27T01:04:00.000Z");
    expect(debate.phase).toBe("REBUTTAL");

    debate = advanceDebatePhase(debate, "2026-09-27T01:05:00.000Z");
    expect(debate.phase).toBe("PROPOSAL");
    expect(debate.currentRound).toBe(2);
    expect(debate.status).toBe("RUNNING");
  });

  it("enters adjudication after the final rebuttal", () => {
    let debate = startDebate(create(), "2026-09-27T01:01:00.000Z");

    for (const now of [
      "2026-09-27T01:02:00.000Z",
      "2026-09-27T01:03:00.000Z",
      "2026-09-27T01:04:00.000Z",
      "2026-09-27T01:05:00.000Z",
      "2026-09-27T01:06:00.000Z",
      "2026-09-27T01:07:00.000Z",
      "2026-09-27T01:08:00.000Z",
    ]) {
      debate = advanceDebatePhase(debate, now);
    }

    expect(debate.status).toBe("ADJUDICATING");
    expect(debate.phase).toBe("ADJUDICATION");
    expect(debate.currentRound).toBe(2);
  });

  it("can only be decided during adjudication", () => {
    expect(() => decideDebate(create(), "2026-09-27T01:02:00.000Z")).toThrow(DebateControlError);
  });

  it("decides an adjudicating debate", () => {
    let debate = startDebate(create(), "2026-09-27T01:01:00.000Z");

    for (let index = 0; index < 7; index += 1) {
      debate = advanceDebatePhase(debate, `2026-09-27T01:0${index + 2}:00.000Z`);
    }

    const decided = decideDebate(debate, "2026-09-27T01:10:00.000Z");

    expect(decided.status).toBe("DECIDED");
    expect(decided.decidedAt).toBe("2026-09-27T01:10:00.000Z");
  });

  it("cancels a running debate", () => {
    const running = startDebate(create(), "2026-09-27T01:01:00.000Z");

    expect(cancelDebate(running, "2026-09-27T01:02:00.000Z").status).toBe("CANCELLED");
  });

  it("does not mutate source participant arrays", () => {
    const participants = ["agent-a", "agent-b"];

    const debate = createDebate({
      id: "debate-1",
      objective: "Compare approaches.",
      participantAgentIds: participants,
      maxParticipants: 2,
      maxRounds: 1,
      createdAt: "2026-09-27T01:00:00.000Z",
    });

    participants.push("agent-c");

    expect(debate.participantAgentIds).toEqual(["agent-a", "agent-b"]);
  });
});
