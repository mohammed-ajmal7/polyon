# POLYON A2A interoperability

POLYON exposes an authenticated A2A JSON-RPC HTTP endpoint at `/api/a2a`.

## Supported operations

The current server supports A2A 1.0-compatible JSON-RPC operations for:

- `SendMessage`
- `SendStreamingMessage`
- `GetTask`
- `ListTasks`
- `CancelTask`
- `SubscribeToTask`
- `CreateTaskPushNotificationConfig`
- `GetTaskPushNotificationConfig`
- `ListTaskPushNotificationConfigs`
- `DeleteTaskPushNotificationConfig`

Legacy operation aliases remain accepted where the existing POLYON baseline used them.

## Streaming

A2A streaming uses Server-Sent Events.

Clients requesting a streaming operation must send:

```http
Accept: text/event-stream
A2A-Version: 1.0
```

Each SSE data frame contains one JSON-RPC response.

For direct streaming message delivery, POLYON emits one agent message event and closes the stream.

For task subscriptions, POLYON emits the current actor-visible task, polls the durable task store at bounded intervals, emits status updates on change, and closes after a terminal task state or the configured stream deadline.

Client aborts stop further delivery.

## Push notifications

Push notification configuration is opt-in and uses the existing durable push configuration store. The Agent Card advertises the capability only when an outbound origin allowlist is configured.

Push delivery is separate from SSE. It does not replace authoritative task state, bypass policy/approval, or replay ambiguous external work.

## Security boundary

Task reads, cancellations, subscriptions, and push configuration validation use the same actor-scoped visibility boundary. A task that is not visible to the authenticated A2A actor is reported as not found.

Streaming and push delivery do not create a bypass around POLYON's policy, approval, audit, privacy, or provider-independence boundaries.

## Deliberate scope

This interoperability slice reuses the durable POLYON task model, execution runtime, and existing push-notification persistence boundary. It does not introduce a second task store or scheduler.
