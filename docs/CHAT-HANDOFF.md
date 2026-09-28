# POLYON Chat Handoff

> Read this with `AGENTS.md`, `docs/PROJECT-CONTEXT.md`, and
> `docs/architecture/001-system-architecture.md`.

## Current repository state

- Repository: `mohammed-ajmal7/polyon`
- Integration branch: `develop`
- Historical architecture branch: `feature/core-architecture`
- Release branch for the first release candidate: `release/0.1.0`
- Current architecture baseline head: **2c84f17060ea468105395ef264d4f6a7bed95002**
- CI is the source of truth for verification. Do not call any branch green until the latest run for the exact head succeeds.

## Implemented operating loop

### Interaction and execution

- Direct, Broadcast, Debate, Mission ingress;
- governed Direct/Broadcast agent orchestration;
- bounded debate runtime;
- Mission planning -> validated task graph -> ready task execution;
- persisted execution lifecycle, retry, cancellation, deadline, recovery;
- result/message/artifact publication and audit trace.

### Agents, models, providers

- agent/model/provider registries and capability-aware routing;
- provider-independent model gateway;
- OpenAI-compatible HTTP text model adapter;
- bounded model invocation timeout/cancellation/retry classification;
- bounded local coding-agent process adapter.

### Tools and integrations

- governed filesystem/terminal/Git/artifact tools;
- dynamic model-facing tool catalog with strict exposure enforcement;
- Google Drive READ integration;
- Telegram SEND_MESSAGE integration;
- Email SEND_EMAIL through provider-neutral SMTP with TLS/STARTTLS, AUTH LOGIN, MIME and protocol bounds;
- all consequential integration/tool execution remains behind policy/approval/audit.

### Memory, research, evidence

- durable memory and scoped search;
- Source + Evidence records with mission/task lineage;
- bounded configurable web research retriever;
- evidence-grounded research synthesis into SUMMARY memory;
- redacted trace query API;
- memory/evidence/source/artifact APIs;
- provider-independent embeddings through a bounded gateway;
- durable versioned memory vectors with content hashes;
- privacy-scoped automatic semantic indexing;
- exact normalized vector indexing with durable rebuild and fallback search.

### Security and operations

- optional HMAC-signed HTTP-only server session;
- same-origin write protection;
- response security headers;
- execution disabled by default;
- explicit model/SMTP/research environment configuration;
- file-backed durable state with migrations, atomic replacement, optimistic concurrency and backup/restore;
- self-hosted Dockerfile + compose configuration;
- CI typecheck/test/lint/format/build gates;
- readiness health checks fail closed on composition/configuration initialization errors and return a stable `503` response without leaking initialization details.

## Intentional remaining work

1. Advanced MCP/A2A features beyond the implemented HTTP baseline.
2. Multi-user/enterprise identity and tenancy, outside the current personal deployment scope.
3. Sustained production-scale load/profiling and broader adversarial E2E coverage.
4. Target-specific deployment automation beyond self-hosted Docker/Compose.

A2A is the current agent-to-agent interoperability path; the former ACP line is not duplicated as an independent modern transport.

## Branch workflow

Use:

```
feature/* -> develop -> release/* -> main
```

Always create a feature branch for a coherent implementation slice. Merge features into `develop` only through CI-backed pull requests. Use `release/0.1.0` for stabilization and final release verification; `main` is reserved for released code.

## Continuation rules

Always:

1. inspect the live branch;
2. inspect the newest CI run for the exact head;
3. select one coherent slice;
4. preserve domain/provider/adapter boundaries;
5. add tests for behavior changes;
6. update docs when architecture/operations change;
7. verify typecheck/test/lint/format/build;
8. report exact verification status.

The repository code and tests outrank this handoff if they differ.
