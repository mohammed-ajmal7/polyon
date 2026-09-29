# POLYON MCP subscriptions/listen

POLYON supports the MCP 2026-07-28 `subscriptions/listen` stream over the authenticated `/api/mcp` endpoint.

## Supported notification subset

The current server advertises and honors:

- `toolsListChanged`;

The server does not currently expose prompt or resource catalogs, so prompt/resource change requests are ignored and omitted from the acknowledgement.

## Stream lifecycle

1. The client sends a `subscriptions/listen` request with `Accept: text/event-stream`.
2. POLYON validates the normal MCP routing headers and request shape.
3. The stream begins with `notifications/subscriptions/acknowledged`.
4. Matching change notifications are emitted as JSON-RPC notification frames.
5. Each notification carries `io.modelcontextprotocol/subscriptionId` metadata containing the listen request id.
6. The stream closes on client abort, explicit cancellation, or the bounded server subscription lifetime.
7. A deliberate lifetime close emits an empty `subscriptions/listen` result before closing the stream.

## Notification bus

The application uses an in-process notification bus with:

- unique internal subscription keys so different clients can reuse JSON-RPC ids safely;
- request-id cancellation mapping;
- bounded per-subscription buffering;
- level-trigger deduplication for queued notifications;
- an explicit publisher boundary for tools, prompts, resources, and resource-URI updates.

The bus and publisher are intentionally replaceable. Application code can publish a typed change through `McpSubscriptionEventPublisher` without depending on wire-level JSON-RPC details. Multi-process/pub-sub persistence is a later deployment concern.

## Safety boundary

`subscriptions/listen` does not execute tools or integrations. It only observes server-side change notifications. Existing policy, approval, audit, and provider boundaries are unchanged.
