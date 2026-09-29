# POLYON MCP subscriptions

POLYON supports the 2026-07-28 MCP subscriptions/listen flow for tool-list changes.

## Supported filter

The server currently honors only toolsListChanged. Prompt and resource subscriptions are acknowledged as unsupported and are omitted from the honored filter.

After acknowledgement, the server polls the same tool/integration catalogs used by tools/list. A catalog fingerprint change produces a notifications/tools/list_changed event carrying the subscription id in the standard protocol metadata.

Only changes observed after acknowledgement are delivered. There is no replay buffer.

## Lifecycle

The stream is bounded by a server-side lifetime and is abort-aware. On graceful server-side expiry it sends the empty subscriptions/listen result before closing. A client abort closes without an additional notification.

All MCP subscription traffic remains behind the existing authenticated web endpoint. The subscription listener is read-only: it does not invoke tools, integrations, or bypass policy/approval.

## Scale and deployment boundary

The first implementation uses deterministic in-process polling because POLYON's current personal self-hosted deployment is single-process oriented. No second durable event bus is introduced. A future multi-process deployment can replace this implementation behind the application boundary without changing the MCP wire contract.
