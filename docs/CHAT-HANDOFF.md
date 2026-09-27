# POLYON Chat Handoff

> Read this with `AGENTS.md`, `docs/PROJECT-CONTEXT.md`, and
> `docs/architecture/001-system-architecture.md`.

## Current repository state

- Repository: `mohammed-ajmal7/polyon`
- Branch: `feature/core-architecture`
- Current implementation head at handoff update: **5f64a69713b1006a5c70f98b6edf6035de6695ea**
- CI is the source of truth for verification. Do not call the current branch green until the latest run for the exact head succeeds.

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
- memory/evidence/source/artifact APIs.

### Security and operations
- optional HMAC-signed HTTP-only server session;
- same-origin write protection;
- response security headers;
- execution disabled by default;
- explicit model/SMTP/research environment configuration;
- file-backed durable state with migrations, atomic replacement, optimistic concurrency and backup/restore;
- self-hosted Dockerfile + compose configuration;
- CI typecheck/test/lint/format/build gates.
- Readiness health checks fail closed on composition/configuration initialization errors and return a stable `503` response without leaking initialization details.
- Optional semantic memory now has a provider-independent embedding gateway, durable versioned vectors with content hashes, bounded cosine search, and an authenticated memory API mode; automatic indexing/reindex recovery remains.

## Intentional remaining work

1. Richer semantic/embedding retrieval beyond the deterministic local path.
2. Advanced MCP/A2A features beyond the implemented HTTP baseline.
3. Multi-user/enterprise identity and tenancy, outside the current personal deployment scope.
4. Production-scale performance and broader adversarial E2E coverage.
5. Target-specific deployment automation beyond self-hosted Docker/Compose.

A2A is the current agent-to-agent interoperability path; the former ACP line is not duplicated as an independent modern transport.
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
