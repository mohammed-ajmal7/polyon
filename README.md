# POLYON

**Personal AI Operations Network**

> Many intelligences. One command.

POLYON is a personal, privacy-first AI workspace for coordinating multiple AI agents, models, tools, research systems, coding agents, and local intelligence.

## Architecture

POLYON separates domain rules, application orchestration, runtime execution, provider adapters, external integrations, durable storage, and the web interface behind explicit boundaries.

Consequential work follows:

```
intent -> policy -> approval (when required) -> execution -> result/audit
```

External integrations in scope are only Google Drive, Telegram, and Email.

## What works today

The current branch contains the core operating loop for:

- Direct and Broadcast agent execution;
- bounded Debate execution;
- Mission planning with validated task graphs and ready-task dispatch;
- durable queued execution, retries, cancellation, deadlines, and restart recovery;
- model/provider routing with a concrete OpenAI-compatible adapter;
- governed filesystem, terminal, Git, artifact, and integration tools;
- Google Drive, Telegram, and SMTP Email adapters;
- durable memory, Source/Evidence records, bounded web research, and evidence-grounded synthesis;
- explicit bounded coding-agent tool/process execution;
- authenticated private web APIs, approval inbox, live trace/state APIs;
- local file-backed persistence, migrations, optimistic concurrency, backup/restore, and self-hosted Docker deployment.

## Safety defaults

The web server starts with execution disabled:

`POLYON_EXECUTION_ENABLED=false`

The default policy is:

`POLYON_APPROVAL_MODE=ASK_EVERYTHING`

Optional private-server authentication is enabled by setting:

`POLYON_API_TOKEN`

Secrets stay server-side. Write APIs enforce same-origin checks. Model-requested tools are rejected when they are not exposed by the active tool contract.

## Local development

```bash
pnpm install
cp apps/web/.env.example apps/web/.env
pnpm dev
```

For self-hosted deployment:

```docker compose up --build
```

Persistent application state is stored in the configured `POLYON_DATA_DIR`.

See `docs/OPERATIONS.md` for configuration and operational guidance.

## Verification

CI runs all of:

1. frozen-lockfile dependency installation;
2. TypeScript typecheck;
3. full Vitest test suite;
4. ESLint;
5. Prettier format check;
6. production build.

The repository also contains focused integration/recovery/security tests across the core, runtime, storage, tools, providers, integrations, and web layers.

## Deliberately pending

The core POLYON operating loop is implemented. The remaining work is now mostly depth, scale, and deployment-specific rather than missing foundations:

- richer semantic/embedding-backed retrieval beyond the deterministic local lexical retriever;
- advanced MCP/A2A features such as streaming, push notifications, subscriptions, and broader spec coverage;
- multi-user/enterprise identity, roles, and tenancy controls (the current product remains intentionally personal);
- production-scale load/performance testing and a larger adversarial end-to-end matrix;
- deployment automation for a specific target environment beyond the self-hosted Docker/Compose path.

Do not add provider-specific coupling to core just to make these boxes appear complete.
## Quality bar

Before a feature is considered complete:

- preserve human authority;
- preserve policy/approval/audit boundaries;
- add focused tests;
- run typecheck/test/lint/format/build;
- inspect the resulting diff;
- document any new operational controls;
- report CI failures honestly.
