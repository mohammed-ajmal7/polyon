# POLYON

**Personal AI Operations Network**

> Many intelligences. One command.

POLYON is a personal, privacy-first AI workspace for coordinating multiple AI agents, models, tools, research systems, coding agents, and local intelligence.

## Open source

POLYON is released under the **MIT License**.

The repository contains the source for the self-hosted POLYON workspace. You can run it locally, connect it to a compatible model provider, or deploy it with Docker Compose.

Open source does not mean that a public POLYON instance is provided by this repository. Hosting, model inference, credentials, and integrations are deployment concerns. POLYON keeps those concerns outside the source tree and exposes configuration through environment variables.

See [LICENSE](LICENSE) for the license terms, [CONTRIBUTING.md](CONTRIBUTING.md) for development workflow, and [SECURITY.md](SECURITY.md) for security reporting and deployment guidance.

## Quick start

Local development:

```bash
pnpm install
cp apps/web/.env.example apps/web/.env
pnpm dev
```

Self-hosted Docker:

```bash
docker compose up --build
```

For a local model, configure an OpenAI-compatible endpoint in `apps/web/.env`. Keep:

```env
POLYON_EXECUTION_ENABLED=false
POLYON_APPROVAL_MODE=ASK_EVERYTHING
```

until the deployment has been validated.

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
- bounded Fact Checker execution over explicit claims and supplied evidence with deterministic verdict validation and audit trace, with opt-in collective/deep-analysis integration;
- bounded automatic semantic indexing with explicit privacy scope opt-in and an exact local vector index with model/dimension candidate bucketing behind a replaceable acceleration boundary;
- authenticated MCP 2026-07-28 subscriptions/listen streaming with bounded notification buffering and a typed publisher boundary;
- A2A 1.0 HTTP interoperability with streaming task subscriptions plus opt-in push-notification configuration, durable task-event dispatch, bounded retries, and delivery auditing;
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
feature/* -> develop -> release/* -> main -> v0.1.0
```

Features and fixes are developed on short-lived `feature/*` branches and merged into `develop` through pull requests. A release branch is cut from `develop` only when the release candidate is ready for stabilization. Production releases are merged to `main` and tagged.

The historical `feature/core-architecture` branch contains the architecture built before this workflow was introduced and is retained as a reference/integration baseline.

## Verification

POLYON uses a local manual verification path. GitHub-hosted Actions are not required for development or release.

Run the repository verification script:

```bash
bash scripts/verify-release.sh
```

Then complete the operational smoke checks in [docs/RELEASE-CHECKLIST.md](docs/RELEASE-CHECKLIST.md) before tagging a release.

## Remaining work after the v0.1 release candidate

The core POLYON operating loop is implemented. Work that can remain after the initial self-hosted release is primarily depth, scale, and deployment-specific:

- advanced MCP/A2A capabilities such as broader specification coverage;
- multi-user/enterprise identity and tenancy (the product remains intentionally personal);
- sustained load/profiling and a wider adversarial end-to-end matrix;
- target-specific deployment automation beyond self-hosted Docker/Compose.

ACP is treated as the legacy line absorbed into the current A2A interoperability path, not as a separate modern transport to duplicate.
