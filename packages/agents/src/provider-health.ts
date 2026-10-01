import type { ProviderId } from "@polyon/contracts";

import type { ProviderHealth } from "./model-routing";
import type { ProviderInvocationErrorKind } from "@polyon/providers";

export interface ProviderHealthSnapshot {
  readonly providerId: ProviderId;
  readonly status: ProviderHealth;
  readonly consecutiveFailures: number;
  readonly lastSuccessAt?: string;
  readonly lastFailureAt?: string;
  readonly lastFailureKind?: ProviderInvocationErrorKind;
}

export interface ProviderHealthTrackerOptions {
  readonly unavailableFailureThreshold?: number;
  /**
   * How long an excluded provider (quota_limited, unavailable, misconfigured) stays excluded
   * after its last failure before routing may probe it again as degraded.
   */
  readonly recoveryCooldownMs?: number;
  readonly now?: () => string;
}

const DEFAULT_UNAVAILABLE_FAILURE_THRESHOLD = 3;
const DEFAULT_RECOVERY_COOLDOWN_MS = 60_000;

export class ProviderHealthTracker {
  private readonly unavailableFailureThreshold: number;
  private readonly recoveryCooldownMs: number;
  private readonly now: () => string;
  private readonly states = new Map<ProviderId, ProviderHealthSnapshot>();

  constructor(options: ProviderHealthTrackerOptions = {}) {
    const threshold = options.unavailableFailureThreshold ?? DEFAULT_UNAVAILABLE_FAILURE_THRESHOLD;

    if (!Number.isInteger(threshold) || threshold < 1) {
      throw new RangeError("Provider unavailable failure threshold must be a positive integer.");
    }

    const cooldown = options.recoveryCooldownMs ?? DEFAULT_RECOVERY_COOLDOWN_MS;
    if (!Number.isFinite(cooldown) || cooldown < 0) {
      throw new RangeError("Provider recovery cooldown must be a non-negative number.");
    }

    this.unavailableFailureThreshold = threshold;
    this.recoveryCooldownMs = cooldown;
    this.now = options.now ?? (() => new Date().toISOString());
  }

  get(providerId: ProviderId): ProviderHealthSnapshot {
    const state = this.states.get(providerId);
    if (state === undefined) {
      return { providerId, status: "healthy", consecutiveFailures: 0 };
    }
    return { ...state, status: this.effectiveStatus(state) };
  }

  snapshot(): Readonly<Record<ProviderId, ProviderHealth>> {
    const result: Record<string, ProviderHealth> = {};

    for (const [providerId, state] of this.states) {
      result[providerId] = this.effectiveStatus(state);
    }

    return result;
  }

  /**
   * Excluded statuses expire after the cooldown so a provider can be probed again; otherwise a
   * single failure would remove it from routing until restart, since only a routed call can
   * record the success that restores it.
   */
  private effectiveStatus(state: ProviderHealthSnapshot): ProviderHealth {
    if (
      state.status !== "quota_limited" &&
      state.status !== "unavailable" &&
      state.status !== "misconfigured"
    ) {
      return state.status;
    }
    const failedAt = state.lastFailureAt === undefined ? NaN : Date.parse(state.lastFailureAt);
    const now = Date.parse(this.now());
    if (!Number.isFinite(failedAt) || !Number.isFinite(now)) return state.status;
    return now - failedAt >= this.recoveryCooldownMs ? "degraded" : state.status;
  }

  recordSuccess(providerId: ProviderId): ProviderHealthSnapshot {
    const next: ProviderHealthSnapshot = {
      providerId,
      status: "healthy",
      consecutiveFailures: 0,
      lastSuccessAt: this.now(),
    };
    this.states.set(providerId, next);
    return next;
  }

  recordFailure(providerId: ProviderId, kind: ProviderInvocationErrorKind): ProviderHealthSnapshot {
    const current = this.get(providerId);

    // A cancelled call says nothing about the provider, and an invalid request (for example a
    // prompt that exceeds the context window) is a property of that request, not the provider.
    if (kind === "CANCELLED" || kind === "INVALID_REQUEST") {
      return current;
    }

    const consecutiveFailures =
      kind === "AUTHENTICATION" ? current.consecutiveFailures : current.consecutiveFailures + 1;

    let status: ProviderHealth;
    switch (kind) {
      case "RATE_LIMITED":
        status = "quota_limited";
        break;
      case "AUTHENTICATION":
        status = "misconfigured";
        break;
      case "UNAVAILABLE":
      case "TIMEOUT":
        status =
          consecutiveFailures >= this.unavailableFailureThreshold ? "unavailable" : "degraded";
        break;
      case "UNKNOWN":
        status = "degraded";
        break;
    }

    const next: ProviderHealthSnapshot = {
      providerId,
      status,
      consecutiveFailures,
      ...(current.lastSuccessAt === undefined ? {} : { lastSuccessAt: current.lastSuccessAt }),
      lastFailureAt: this.now(),
      lastFailureKind: kind,
    };

    this.states.set(providerId, next);
    return next;
  }

  reset(providerId: ProviderId): ProviderHealthSnapshot {
    return this.recordSuccess(providerId);
  }
}
