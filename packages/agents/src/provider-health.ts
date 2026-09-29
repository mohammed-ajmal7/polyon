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
  readonly now?: () => string;
}

const DEFAULT_UNAVAILABLE_FAILURE_THRESHOLD = 3;

export class ProviderHealthTracker {
  private readonly unavailableFailureThreshold: number;
  private readonly now: () => string;
  private readonly states = new Map<ProviderId, ProviderHealthSnapshot>();

  constructor(options: ProviderHealthTrackerOptions = {}) {
    const threshold = options.unavailableFailureThreshold ?? DEFAULT_UNAVAILABLE_FAILURE_THRESHOLD;

    if (!Number.isInteger(threshold) || threshold < 1) {
      throw new RangeError("Provider unavailable failure threshold must be a positive integer.");
    }

    this.unavailableFailureThreshold = threshold;
    this.now = options.now ?? (() => new Date().toISOString());
  }

  get(providerId: ProviderId): ProviderHealthSnapshot {
    return (
      this.states.get(providerId) ?? {
        providerId,
        status: "healthy",
        consecutiveFailures: 0,
      }
    );
  }

  snapshot(): Readonly<Record<ProviderId, ProviderHealth>> {
    const result: Record<string, ProviderHealth> = {};

    for (const [providerId, state] of this.states) {
      result[providerId] = state.status;
    }

    return result;
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

  recordFailure(
    providerId: ProviderId,
    kind: ProviderInvocationErrorKind,
  ): ProviderHealthSnapshot {
    const current = this.get(providerId);

    if (kind === "CANCELLED") {
      return current;
    }

    const consecutiveFailures =
      kind === "AUTHENTICATION" || kind === "INVALID_REQUEST"
        ? current.consecutiveFailures
        : current.consecutiveFailures + 1;

    let status: ProviderHealth;
    switch (kind) {
      case "RATE_LIMITED":
        status = "quota_limited";
        break;
      case "AUTHENTICATION":
      case "INVALID_REQUEST":
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
