# POLYON

**Personal AI Operations Network**

> Many intelligences. One command.

POLYON is a personal, privacy-first AI workspace for coordinating multiple AI agents, models, tools, research systems, coding agents, and local intelligence.

## Architecture

POLYON keeps domain logic, application orchestration, runtime execution, provider adapters, external integrations, durable storage, and the web interface separated by explicit boundaries.

Consequential actions flow through policy → approval (when required) → execution → audit.

External integrations are intentionally limited to Google Drive, Telegram, and Email.

## Development

```bash
pnpm install
pnpm dev
pnpm lint
pnpm typecheck
pnpm test
pnpm format
pnpm format:check
pnpm build
```

## Local server configuration

Start from `apps/web/.env.example`.

Core variables:

- `POLYON_DATA_DIR` — durable local application state.
- `POLYON_RUNTIME_AUTOSTART` — start the execution worker automatically.
- `POLYON_EXECUTION_ENABLED` — must be `true` to enable the web execution endpoint; default is `false`.
- `POLYON_APPROVAL_MODE` — `ASK_EVERYTHING`, `BALANCED`, or `AUTO`; safe default is `ASK_EVERYTHING`.
- `POLYON_API_TOKEN` — optional server access token for the private web/API surface.

### Model execution

Set `POLYON_MODEL_ENDPOINT` and `POLYON_MODEL_ID` to configure an explicit model provider. The provider is accessed through POLYON's provider-independent model adapter.

### Email

Set `POLYON_SMTP_HOST`, `POLYON_SMTP_USERNAME`, and either the environment secret or encrypted secret-store configuration. Email remains governed as a non-idempotent external communication action.

### Research

Set `POLYON_RESEARCH_SEARCH_ENDPOINT` and `POLYON_RESEARCH_ALLOWED_HOSTS` to enable the bounded search-provider adapter. POLYON does not grant arbitrary outbound web access.

## Verification

CI runs:

1. dependency installation with a frozen lockfile;
2. typecheck;
3. tests;
4. lint;
5. format check;
6. production build.

## Security posture

- secrets never belong in client-side code;
- web writes are same-origin checked;
- private APIs can require an HTTP-only authenticated session;
- security headers are enabled by the Next.js server config;
- execution is disabled by default;
- model-requested tools are denied when they are not exposed in the active tool contract;
- local coding-agent processes use explicit executable and workspace bounds.

Do not commit API keys, access tokens, OAuth secrets, private keys, credentials, or private user data.

## Remaining work

The remaining roadmap is intentionally explicit: native MCP/A2A/ACP transports, concrete creative providers, richer multi-step mission planning, stronger production authentication/session management, richer semantic retrieval, and deployment/backup/load/adversarial E2E hardening.

