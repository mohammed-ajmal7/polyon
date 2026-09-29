# POLYON MCP Streamable HTTP

POLYON exposes an authenticated MCP HTTP endpoint at `/api/mcp`.

The 2026-07-28 MCP baseline remains the protocol contract. The endpoint accepts the existing stateless JSON-RPC request shape and can return a streamed response when the caller includes `Accept: text/event-stream`.

## Streaming boundary

For non-notification requests, the application service exposes the same final JSON-RPC response through an async stream.

The stream is intentionally bounded to the existing request lifetime:

1. validate the MCP protocol/version and standard routing headers;
2. execute the request through the existing tool or integration invocation service;
3. emit the resulting JSON-RPC response as an SSE data frame;
4. close the response.

This means streamed `tools/call` requests still cross the normal policy, approval, input-validation, audit, and adapter boundaries exactly once.

Notifications such as `notifications/initialized` continue to use the existing no-response behavior and are not converted into empty SSE streams.

## HTTP behavior

The web route:

- requires the existing authenticated API boundary;
- preserves the existing request byte limit;
- uses `text/event-stream; charset=utf-8` for streamed responses;
- disables response caching/buffering;
- honors `Request.signal` so aborted clients stop delivery;
- returns ordinary JSON for callers that do not request SSE.

The route does not create a second MCP endpoint or bypass the existing application service.

## Deliberate scope

This slice adds streamable HTTP responses but does not yet implement the 2026-07-28 `subscriptions/listen` notification bus. That will be a separate change because it requires explicit lifecycle/publishing semantics rather than merely changing the response transport.
