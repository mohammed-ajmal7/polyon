# POLYON model routing

POLYON model selection is centralized in `@polyon/agents`.

The router applies deterministic constraints before selecting a model:

- agent must be active;
- required capabilities must be available;
- model and provider must be enabled;
- privacy constraints must match the selected lane;
- zero-cost routing excludes paid models;
- minimum context-window requirements must be satisfied;
- tool-enabled work requires a model that declares tool support;
- unavailable or misconfigured providers are excluded;
- quota-limited providers are excluded from that route;
- degraded providers remain eligible but receive a routing penalty.

Preferred/fallback ordering is preserved when candidates are otherwise equivalent. Provider health can therefore move a healthy fallback ahead of a degraded preferred provider.

The router returns the selected agent, model, provider, source (`PREFERRED` or `FALLBACK`), provider health, and deterministic score so the decision can be inspected and recorded by the application layer.

## Privacy and cost

Privacy and cost constraints are hard filters. The router does not rely on model instructions to avoid a cloud or paid provider.

When `allowPaidModels` is false, a model must explicitly be free or belong to a local-model provider. Unknown cost classification on hosted providers is not treated as free.

When `privacyClass` is `local`, a cloud provider cannot satisfy the request unless the model explicitly declares itself local.

## Provider health

The router accepts an application-supplied provider health snapshot: `healthy`, `degraded`, `quota_limited`, `unavailable`, or `misconfigured`.

Health is supplied outside the core registry so it can later come from probes, telemetry, quota signals, or operator controls without coupling the router to a provider implementation.

## Boundary

The routing package does not call a provider, inspect API credentials, or contain UI logic. It selects from registered agent/model/provider metadata.

Provider-specific endpoint and credential configuration belongs in the provider/application adapter layer.