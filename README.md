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

The current integration line contains the core operating loop for:

- Direct and Broadcast agent execution;
- bounded Debate execution;
- Mission planning with validated task graphs and ready-task dispatch;
- durable queued execution, retries, cancellation, deadlines, and restart recovery;
- model/provider routing with a concrete OpenAI-compatible adapter;
- governed filesystem, terminal, Git, artifact, and integration tools;
- Google Drive, Telegram, and SMTP Email adapters;
- durable memory, Source/Evidence records, bounded web research, evidence-grounded synthesis, and optional semantic memory search with durable embeddings;
- bounded automatic semantic indexing with explicit privacy scope opt-in and an exact local vector index with a replaceable acceleration boundary;
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

## Branch and release flow

Development uses a protected integration path:

```
feature/* -> develop -> release/0.1.0 -> main -> v0.1.0
```

Features and fixes are developed on short-lived `feature/*` branches and merged into `develop` through pull requests. A release branch is cut from `develop` only when the release candidate is ready for stabilization. Production releases are merged to `main` and tagged.

The historical `feature/core-architecture` branch contains the architecture built before this workflow was introduced and is retained as a reference/integration baseline.

## Local development

```bash
pnpm install
cp apps/web/.env.example apps/web/.env
pnpm dev
```

For self-hosted deployment:

```bash
docker compose up --build
```

Persistent application state is stored in the configured `POLYON_DATA_DIR`.

See `docs/OPERATIONS.md` for configuration and operational guidance and `docs/RELEASE-CHECKLIST.md` for release verification.

## Verification

CI runs all of:

1. frozen-lockfile dependency installation;
2. TypeScript typecheck;
3. full Vitest test suite;
4. ESLint;
5. Prettier format check;
6. production build;
7. Docker image build;
8. Docker Compose configuration validation.

The repository also contains focused integration/recovery/security tests across the core, runtime, storage, tools, providers, integrations, and web layers.

## Remaining work after the v0.1 release candidate

The core POLYON operating loop is implemented. Work that can remain after the initial self-hosted release is primarily depth, scale, and deployment-specific:

- advanced MCP/A2A capabilities such as streaming, push notifications, subscriptions, and broader specification coverage;
- multi-user/enterprise identity and tenancy (the product remains intentionally personal);
- sustained load/profiling and a wider adversarial end-to-end matrix;
- target-specific deployment automation beyond self-hosted Docker/Compose.

ACP is treated as the legacy line absorbed into the current A2A interoperability path, not as a separate modern transport to duplicate.

## Quality bar

Before a feature is considered complete:

- preserve human authority;
- preserve policy/approval/audit boundaries;
- add focused tests;
- run typecheck/test/lint/format/build;
- inspect the resulting diff;
- document any new operational controls;
- report CI failures honestly.
