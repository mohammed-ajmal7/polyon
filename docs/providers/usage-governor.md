# POLYON usage and cost governor

The usage governor is the enforcement point for model-call budgets.

It supports:

- zero-cost mode;
- daily provider request limits;
- monthly provider request limits;
- per-run token limits;
- per-run distinct-agent limits;
- per-run debate-round limits.

A model invocation is authorized before the provider adapter is called. Each retry attempt is authorized separately, so retries cannot bypass request budgets. A reservation holds the conservative token estimate while the provider call is running; returned model usage reconciles the reservation after success.

## Cost modes

`configured` records and enforces configured budgets but does not block a model solely because its cost class is paid or unknown.

`zero` permits only explicitly free usage. Local-model providers are treated as free when no more specific model cost classification exists. Hosted models without an explicit free classification are blocked instead of being assumed free.

## Configuration

The web server reads:

```env
POLYON_COST_MODE=configured
POLYON_USAGE_BUDGETS_JSON=
```

Budget values are configuration data. External provider quotas and pricing are not hard-coded into the governor.

## Boundary

The governor is provider-neutral. It does not know how an AI provider works and does not contain policy or approval rules. It prevents uncontrolled model usage; consequential actions remain governed by the separate policy and approval boundary.

Usage state is currently process-local. Durable usage accounting, long-horizon reporting, and multi-process aggregation remain a later persistence/observability layer.
