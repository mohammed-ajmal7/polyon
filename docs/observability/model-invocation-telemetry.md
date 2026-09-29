# POLYON model invocation telemetry

Every model attempt can emit a provider-neutral telemetry record containing:

- provider and model identity;
- optional agent-run and agent identity;
- retry attempt number;
- success/failure status;
- estimated and provider-reported token usage;
- latency;
- model cost class;
- normalized provider failure kind;
- recording timestamp.

The provider package only exposes a telemetry sink interface. The application composition supplies the durable event sink, keeping storage concerns out of the provider adapter layer.

AgentGateway automatically forwards its agent ID and optional run ID into the model usage context. Collective, research, and deep-analysis debate paths pass their existing run IDs.

TraceQueryService can filter durable trace events by `agentRunId` while redacting secret-like fields.

Telemetry is observational: it does not alter model routing decisions or convert cost classes into monetary estimates.
