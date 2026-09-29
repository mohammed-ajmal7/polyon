import { describe, expect, it } from "vitest";

import { ProviderHealthTracker } from "./provider-health";

describe("ProviderHealthTracker", () => {
  it("starts unknown providers as healthy", () => {
    const tracker = new ProviderHealthTracker();
    expect(tracker.get("provider-1")).toMatchObject({
      providerId: "provider-1",
      status: "healthy",
      consecutiveFailures: 0,
    });
  });

  it("marks rate-limited providers as quota-limited", () => {
    const tracker = new ProviderHealthTracker();

    const result = tracker.recordFailure("provider-1", "RATE_LIMITED");

    expect(result).toMatchObject({
      status: "quota_limited",
      lastFailureKind: "RATE_LIMITED",
      consecutiveFailures: 1,
    });
    expect(tracker.snapshot()).toEqual({ "provider-1": "quota_limited" });
  });

  it("marks authentication failures as misconfigured", () => {
    const tracker = new ProviderHealthTracker();

    expect(tracker.recordFailure("provider-1", "AUTHENTICATION").status).toBe("misconfigured");
  });

  it("does not change provider health for a request-specific invalid request", () => {
    const tracker = new ProviderHealthTracker();

    expect(tracker.recordFailure("provider-1", "INVALID_REQUEST").status).toBe("healthy");
    expect(tracker.snapshot()).toEqual({});
  });

  it("lets an excluded provider be probed again after the recovery cooldown", () => {
    let now = "2026-09-29T10:00:00.000Z";
    const tracker = new ProviderHealthTracker({ recoveryCooldownMs: 60_000, now: () => now });

    tracker.recordFailure("provider-1", "RATE_LIMITED");
    tracker.recordFailure("provider-2", "AUTHENTICATION");
    expect(tracker.snapshot()).toEqual({
      "provider-1": "quota_limited",
      "provider-2": "misconfigured",
    });

    now = "2026-09-29T10:01:00.000Z";
    expect(tracker.snapshot()).toEqual({ "provider-1": "degraded", "provider-2": "degraded" });
    expect(tracker.get("provider-1").status).toBe("degraded");

    expect(tracker.recordSuccess("provider-1").status).toBe("healthy");
  });

  it("transitions repeated availability failures from degraded to unavailable", () => {
    const tracker = new ProviderHealthTracker({ unavailableFailureThreshold: 2 });

    expect(tracker.recordFailure("provider-1", "UNAVAILABLE").status).toBe("degraded");
    expect(tracker.recordFailure("provider-1", "TIMEOUT").status).toBe("unavailable");
  });

  it("does not poison provider health for caller cancellation", () => {
    const tracker = new ProviderHealthTracker();
    tracker.recordFailure("provider-1", "UNAVAILABLE");

    const result = tracker.recordFailure("provider-1", "CANCELLED");

    expect(result.status).toBe("degraded");
    expect(result.consecutiveFailures).toBe(1);
    expect(result.lastFailureKind).toBe("UNAVAILABLE");
  });

  it("resets a provider after a successful invocation", () => {
    let time = "2026-09-29T00:00:00.000Z";
    const tracker = new ProviderHealthTracker({ now: () => time });
    tracker.recordFailure("provider-1", "UNAVAILABLE");

    time = "2026-09-29T00:01:00.000Z";
    expect(tracker.recordSuccess("provider-1")).toMatchObject({
      status: "healthy",
      consecutiveFailures: 0,
      lastSuccessAt: time,
    });
  });
});
