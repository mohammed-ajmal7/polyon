# POLYON A2A interoperability

POLYON exposes an authenticated A2A JSON-RPC HTTP endpoint at `/api/a2a`.

## Supported A2A 1.0 operations

The current server supports:

- `SendMessage`
- `SendStreamingMessage`
- `GetTask`
- `ListTasks`
- `CancelTask`
- `SubscribeToTask`

Legacy operation aliases remain accepted where the existing baseline used them.

## Streaming

A2A streaming uses Server-Sent Events.

Clients requesting:

- `SendStreamingMessage`
- `SubscribeToTask`

must send:

```http
Accept: text/event-stream
A2A-Version: 1.0
```

Each SSE data frame contains one JSON-RPC response whose `result` is an A2A v1 `StreamResponse`.

For direct message execution, POLYON emits a single message event and closes the stream.

For task subscription, POLYON:

1. emits the current task;
2. polls the durable task store for bounded status changes;
3. emits a `statusUpdate` when the task changes;
4. closes after a terminal task state;
5. enforces a maximum stream lifetime.

The stream is abort-aware so client disconnects stop further delivery.

## Security boundary

Task subscriptions and task reads use the same actor-scoped execution visibility check as the existing A2A task APIs. A task that is not visible to the authenticated A2A actor is reported as not found.

High-risk actions continue through POLYON's existing governed tool/integration and approval infrastructure. Streaming does not create a bypass around policy.

## Deliberate scope

Push notification configuration is not enabled yet. The Agent Card continues to advertise `pushNotifications: false`.

This slice also does not create a second task/event store. It reuses the existing durable POLYON task model and execution runtime.
