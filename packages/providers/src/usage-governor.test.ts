import { describe, expect, it } from "vitest";

import { UsageGovernor, UsageGovernorError } from ".";

describe("UsageGovernor", () => {
  it("blocks non-free models in zero-cost mode", () => {
    const governor = new UsageGovernor({ costMode: "zero" });

    expect(() =>
      governor.authorize({
        providerId: "cloud",
        modelId: "model",
        context: { costClass: "unknown" },
      }),
    ).toThrowError(
      new UsageGovernorError(
        "PAID_MODEL_BLOCKED",
        "cloud",
        "model",
        "Zero-cost mode blocked model model because its cost class is unknown.",
      ),
    );
  });

  it("enforces daily and monthly request limits", () => {
    let now = "2026-09-29T00:00:00.000Z";
    const governor = new UsageGovernor({
      budgets: [{ providerId: "local", dailyRequestLimit: 1, monthlyRequestLimit: 2 }],
      now: () => now,
    });

    governor.authorize({ providerId: "local", modelId: "model" }).complete();

    expect(() =>
      governor.authorize({ providerId: "local", modelId: "model" }),
    ).toThrowError(expect.objectContaining({ kind: "DAILY_REQUEST_LIMIT" }));

    now = "2026-10-01T00:00:00.000Z";
    governor.authorize({ providerId: "local", modelId: "model" }).complete();

    expect(governor.providerSnapshot("local")).toMatchObject({
      day: "2026-10-01",
      month: "2026-10",
      dailyRequests: 1,
      monthlyRequests: 1,
    });
  });

  it("enforces per-run tokens and distinct agent limits", () => {
    const governor = new UsageGovernor({
      budgets: [{ providerId: "local", maxTokensPerRun: 100, maxAgentsPerRun: 2 }],
    });

    governor.authorize({
      providerId: "local",
      modelId: "model",
      estimatedTokens: 60,
      context: { runId: "run-1", agentId: "a", agentCount: 1 },
    }).complete(50);

    governor.authorize({
      providerId: "local",
      modelId: "model",
      estimatedTokens: 40,
      context: { runId: "run-1", agentId: "b", agentCount: 2 },
    }).complete(30);

    expect(governor.runSnapshot("run-1", "local")).toMatchObject({
      tokens: 80,
      agents: 2,
    });

    expect(() =>
      governor.authorize({
        providerId: "local",
        modelId: "model",
        estimatedTokens: 30,
        context: { runId: "run-1", agentId: "c", agentCount: 3 },
      }),
    ).toThrowError(expect.objectContaining({ kind: "RUN_AGENT_LIMIT" }));
  });

  it("enforces debate round limits", () => {
    const governor = new UsageGovernor({
      budgets: [{ providerId: "local", maxDebateRounds: 2 }],
    });

    expect(() =>
      governor.authorize({
        providerId: "local",
        modelId: "model",
        context: { debateRound: 3 },
      }),
    ).toThrowError(expect.objectContaining({ kind: "DEBATE_ROUND_LIMIT" }));
  });

  it("tracks actual usage while reserving a conservative estimate", () => {
    const governor = new UsageGovernor({
      budgets: [{ providerId: "local", maxTokensPerRun: 100 }],
    });

    const reservation = governor.authorize({
      providerId: "local",
      modelId: "model",
      estimatedTokens: 90,
      context: { runId: "run-2" },
    });

    expect(governor.runSnapshot("run-2", "local").tokens).toBe(90);
    reservation.complete(20);
    expect(governor.runSnapshot("run-2", "local").tokens).toBe(20);
  });
});
