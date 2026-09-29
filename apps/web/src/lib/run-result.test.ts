import { describe, expect, it } from "vitest";

import { agentLabel, toRunView } from "./run-result";

describe("toRunView", () => {
  it("shows a direct answer", () => {
    const view = toRunView("Direct", {
      result: {
        status: "SUCCEEDED",
        responses: [
          {
            agentId: "primary-action-agent",
            result: { status: "SUCCEEDED", response: { content: "Hello!" } },
          },
        ],
      },
    });

    expect(view).toMatchObject({ outcome: "answered", answer: "Hello!", approvalsWaiting: 0 });
  });

  it("reports a direct request that is waiting for approval", () => {
    const view = toRunView("Direct", {
      result: {
        status: "APPROVAL_REQUIRED",
        responses: [{ agentId: "primary-action-agent", result: { status: "APPROVAL_REQUIRED" } }],
      },
    });

    expect(view).toMatchObject({ outcome: "needs-approval", approvalsWaiting: 1 });
    expect(view.answer).toBeUndefined();
  });

  it("separates confirmed and uncertain claims in a deep analysis", () => {
    const view = toRunView("DeepAnalysis", {
      result: {
        status: "SUCCEEDED",
        decision: { content: "Final judgement." },
        collective: {
          status: "SUCCEEDED",
          conversationId: "conversation-1",
          synthesis: { content: "Synthesis." },
          contributions: [{ agentId: "primary-researcher", role: "Researcher" }],
          failures: [],
          sourceIds: ["source-1", "source-2"],
          factChecks: [
            { claim: "A", verdict: "SUPPORTED", rationale: "Evidence agrees." },
            { claim: "B", verdict: "UNRESOLVED", rationale: "No evidence." },
          ],
        },
      },
    });

    expect(view).toMatchObject({
      outcome: "answered",
      answer: "Final judgement.",
      sourceCount: 2,
      conversationId: "conversation-1",
    });
    expect(view.confirmed.map((check) => check.claim)).toEqual(["A"]);
    expect(view.uncertain.map((check) => check.claim)).toEqual(["B"]);
  });

  it("marks a collective run without a synthesis as failed and lists the problems", () => {
    const view = toRunView("Collaborative", {
      result: {
        status: "FAILED",
        contributions: [{ agentId: "primary-analyst" }],
        failures: [{ agentId: "primary-critic", error: "fetch failed" }],
        sourceIds: [],
      },
    });

    expect(view.outcome).toBe("failed");
    expect(view.problems).toEqual(["primary-critic: fetch failed"]);
  });

  it("links a mission that needs plan approval", () => {
    const view = toRunView("Mission", {
      result: { status: "PLAN_APPROVAL_REQUIRED", mission: { id: "mission-1" } },
    });

    expect(view).toMatchObject({ outcome: "needs-approval", missionId: "mission-1" });
  });

  it("tolerates unexpected payloads", () => {
    expect(toRunView("Collaborative", null).outcome).toBe("failed");
    expect(toRunView("Unknown", {}).outcome).toBe("failed");
  });
});

describe("agentLabel", () => {
  it("turns agent ids into readable role names", () => {
    expect(agentLabel("primary-fact-checker")).toBe("Fact checker");
    expect(agentLabel("researcher")).toBe("Researcher");
  });
});
