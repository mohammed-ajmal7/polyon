# POLYON authenticated A2A extended Agent Card

POLYON exposes the A2A authenticated extended Agent Card through the existing A2A HTTP boundary. No new persistence, queue, authentication system, or provider adapter is introduced.

## Endpoints

- Public discovery remains `GET /.well-known/agent-card.json`.
- Authenticated extended discovery is `GET /api/a2a/extendedAgentCard`.
- The JSON-RPC binding also accepts `GetExtendedAgentCard` on the existing `/api/a2a` endpoint.

The extended endpoint requires the existing POLYON request authentication boundary. It returns `application/a2a+json` and uses `private, no-store` caching because the response is authenticated.

## Capability declaration

```json
{
  "capabilities": {
    "extendedAgentCard": true
  }
}
```

The current authenticated card intentionally mirrors the public card content. This is a real protocol operation without exposing private server configuration or secrets. The implementation leaves the existing AgentCard construction as the single source of truth so future authenticated-only capability detail can be added without creating a second discovery model.

## Safety boundary

The extended-card operation is read-only. It does not execute tools, change task state, access provider credentials, or bypass policy/approval. Authentication is enforced before composition access at the HTTP route, while the application service keeps Agent Card construction provider-independent.
