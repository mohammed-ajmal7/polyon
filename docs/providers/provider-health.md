# POLYON provider health

Provider health is an application-side signal used by model routing.

## States

- `healthy`: normal routing.
- `degraded`: temporary reliability problems; still eligible but penalized.
- `quota_limited`: provider is excluded until it succeeds again.
- `unavailable`: repeated availability failures crossed the configured threshold.
- `misconfigured`: authentication or invalid-request failures indicate configuration needs attention.

## Signals

The gateway records provider outcomes without storing provider error text in the health state:

- rate limiting -> `quota_limited`;
- authentication/invalid request -> `misconfigured`;
- timeout/unavailable/unknown -> degraded, then unavailable after repeated failures;
- caller cancellation does not change provider health;
- successful invocation resets the provider to healthy.

## Routing

The provider health snapshot is passed into the central model router before every agent invocation. A retryable provider failure is recorded, then POLYON performs one bounded route re-evaluation.

This allows a healthy fallback provider to take over without changing the orchestration layer or exposing provider-specific logic to the UI.

The failover attempt is bounded to prevent retry loops. Provider health is shared by the composition's AgentGateway instance.

## Boundary

Health tracking remains provider-neutral. It does not perform health probes, contain credentials, or decide permissions. Future observability/probing can feed additional health signals into the same tracker.

Health state is currently process-local. Durable health history and fleet dashboards are a later observability layer.
