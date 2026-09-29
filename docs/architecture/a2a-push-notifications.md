# A2A Push Notifications

POLYON implements the A2A 1.0 push-notification configuration boundary as an opt-in capability.

## Supported operations

The JSON-RPC A2A service supports:

- `CreateTaskPushNotificationConfig`
- `GetTaskPushNotificationConfig`
- `ListTaskPushNotificationConfigs`
- `DeleteTaskPushNotificationConfig`

Configuration is scoped to the A2A actor and task. Authentication credentials are accepted for delivery but are never returned by the read operations.

## Delivery

When the configured POLYON execution runtime completes a task, the push service emits an A2A 1.0 `StreamResponse` using the `statusUpdate` member. Delivery is best-effort: a failed webhook does not change the authoritative task state.

The outbound webhook sender is deliberately bounded:

- public webhook URLs must use HTTPS;
- loopback HTTP URLs are allowed for local/self-hosted development;
- destinations must be explicitly allowlisted;
- notification requests use bounded JSON payloads and POST;
- authentication header values are validated against header-injection characters;
- delivery failures do not trigger task replay.

## Configuration

Set:

`POLYON_A2A_PUSH_ALLOWED_ORIGINS=https://client.example.com,https://another.example.com`

The capability remains disabled when the allowlist is empty. This prevents an untrusted A2A client from turning the server into an arbitrary outbound HTTP proxy.

## Scope

Push configurations are stored in the existing durable domain-state file and participate in the same revision/migration/backup boundary as other POLYON domain data. The A2A service still depends only on its store abstraction, so the storage implementation remains replaceable.
