# POLYON Chat Handoff

> Read this with `AGENTS.md`, `docs/PROJECT-CONTEXT.md`, and
> `docs/architecture/001-system-architecture.md`.

## Current repository state

- Repository: `mohammed-ajmal7/polyon`
- Branch: `feature/core-architecture`
- Current implementation head at handoff update: **8b3ef35d2415db6953c767d417bbf8cf4cf62f1b**
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

## Intentional remaining work

1. Native MCP/A2A/ACP transports and negotiation.
2. Concrete creative provider adapters.
3. Richer semantic retrieval/context assembly.
4. Multi-user/enterprise auth and authorization.
5. High-volume performance/load tests and broad adversarial E2E coverage.
6. Docker image build in CI and fuller deployment automation.

These are real remaining areas. Do not simulate protocol or provider support with placeholders.

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
