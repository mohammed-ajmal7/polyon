# POLYON Operations Guide

## Local

```bash
pnpm install
cp apps/web/.env.example apps/web/.env
pnpm dev
```

The web app listens on the Next.js development server. The persistent state directory defaults to `.polyon-data` unless `POLYON_DATA_DIR` is set.

## Safe defaults

Keep:

```text
POLYON_EXECUTION_ENABLED=false
POLYON_APPROVAL_MODE=ASK_EVERYTHING
```

Enable execution only after the model, tool roots, integrations, and approval workflow have been configured and tested.

## Model

Set:

- `POLYON_MODEL_ENDPOINT`
- `POLYON_MODEL_ID`

Optionally set `POLYON_MODEL_API_KEY`.

Provider-specific authentication remains outside the client and outside core domain code.

## Email

Set:

- `POLYON_SMTP_HOST`
- `POLYON_SMTP_USERNAME`
- `POLYON_SMTP_PASSWORD`

or configure the encrypted local secret store with `POLYON_SECRET_STORE_PATH` and `POLYON_SECRET_MASTER_KEY_BASE64`.

SMTP can use implicit TLS or STARTTLS, but not both for the same transport configuration.

## Embeddings

Set `POLYON_EMBEDDING_ENDPOINT` and `POLYON_EMBEDDING_MODEL_ID` to enable optional semantic memory indexing/search. The endpoint must be HTTP(S); credentials remain server-side in `POLYON_EMBEDDING_API_KEY`. Embeddings are stored with model identity and a content hash so stale vectors are ignored after memory edits.

Semantic indexing/search is optional; lexical memory search remains available without an embedding provider.

## Research

Set both:

- `POLYON_RESEARCH_SEARCH_ENDPOINT`
- `POLYON_RESEARCH_ALLOWED_HOSTS`

The endpoint must be HTTPS. Source fetching remains bounded by the configured HTTP allowlist and response limits.

## Creative

Optional creative operations use explicit HTTPS provider endpoints:

- `POLYON_CREATIVE_IMAGE_ENDPOINT`
- `POLYON_CREATIVE_VIDEO_ENDPOINT`
- `POLYON_CREATIVE_AUDIO_ENDPOINT`
- `POLYON_CREATIVE_VOICE_ENDPOINT`
- `POLYON_CREATIVE_EDIT_ENDPOINT`

Only configured operations are enabled. Provider requests remain bounded and provider-specific SDKs are not required.

## Private web/API access

Set `POLYON_API_TOKEN` to require authentication.

The browser receives only an HTTP-only session cookie. The raw server token is never returned by the web API.

## Self-hosted Docker

```bash
docker compose up --build
```

The compose file persists `POLYON_DATA_DIR` to a named volume. The container ships with execution disabled and ASK_EVERYTHING as its default policy.

Do not expose the container publicly without configuring authentication and a reverse proxy/TLS boundary appropriate to the deployment.

## Data protection

The file-backed database uses versioned snapshots, migrations, atomic replacement and optimistic concurrency protection.

Use the storage-layer backup service for snapshots before major upgrades or schema changes. Restore inputs are validated before replacement.

## Health endpoints

- `GET /api/health/live` reports whether the runtime is running and is suitable for liveness checks.
- `GET /api/health/ready` reports readiness and returns `503` when the runtime is not running, required model configuration is missing while execution is enabled, or server composition initialization fails.
- Readiness responses do not expose initialization error details; configuration failures fail closed.

## Operational checks

Before enabling consequential execution:

- verify the active agent/model and fallback routing;
- verify filesystem/terminal/Git roots and executable allowlists;
- verify integration credentials through their opaque secret references;
- verify approval resolution and execution recovery;
- verify trace APIs do not disclose secrets;
- run the CI quality gate against the exact deployed commit.
