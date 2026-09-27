# POLYON Chat Handoff

> Read this with `AGENTS.md`, `docs/PROJECT-CONTEXT.md`, and
> `docs/architecture/001-system-architecture.md`.

## Current repository state

- Repository: `mohammed-ajmal7/polyon`
- Branch: `feature/core-architecture`
- Current implementation head: `4ae6c412429f7a01401fe4c469efe4b24f4b78f1`
- CI run: **987** is the current verification run for this head; do not call the branch green until the run is successful.
- Always inspect the live branch and newest CI run before editing.

## Product

POLYON = **Personal AI Operations Network**.

The human remains the final authority.

Core rules:
- policy before consequential action;
- approval where required;
- provider independence;
- adapter boundaries;
- privacy first;
- deterministic controls;
- traceability and evidence;
- bounded autonomy;
- replaceability;
- zero additional operating cost by default.

Planned external integrations are only Google Drive, Telegram, and Email.

## Implemented foundations

### Core execution
- mission/task/execution lifecycle;
- dependency graphs and ready-task advancement;
- queueing, retries, cancellation, deadlines and recovery;
- durable execution state and restart-safe continuations;
- policy decisions, approval requests and execution gating;
- idempotent result publication and audit events.

### Model and agent layer
- provider/model/agent registries;
- provider-independent model gateway;
- agent routing with capability requirements;
- governed model tool calls;
- bounded tool rounds and bounded tool outputs.

### Tools and coding
- scoped filesystem, terminal, Git, commit and publish tools;
- artifact creation and bounded artifact access;
- explicit coding-agent tool profile;
- strict rejection of model-requested tools that are outside the exposed tool contract;
- bounded local process agent runtime with executable allowlist, workspace confinement,
  no shell interpretation, input/output limits and timeouts.

### Knowledge and research
- durable memory model with PRIVATE/PROJECT/MISSION/TASK scopes;
- deterministic bounded memory search;
- durable Source + Evidence records;
- mission/task-scoped evidence lineage;
- bounded web research retriever;
- configurable HTTP search-provider boundary;
- evidence-grounded research synthesis persisted as SUMMARY memory;
- redacted trace query API.

### Debate
- finite PROPOSAL → CRITICISM → EVIDENCE → REBUTTAL → ADJUDICATION flow;
- persisted contributions and decisions;
- restart-safe contribution recovery;
- no external action from debate participants directly.

### Integrations and secrets
- Google Drive, Telegram, Email adapter boundaries;
- bounded outbound HTTP;
- opaque secret references;
- environment secret resolver;
- encrypted-at-rest file secret resolver with AES-256-GCM, atomic replacement and metadata matching;
- provider-neutral SMTP transport with TLS/STARTTLS, AUTH LOGIN, bounded responses/writes,
  MIME encoding, envelope validation, line/size bounds and sanitized errors.

### Web / AI HQ
- live Next.js dashboard;
- command center;
- Direct/Broadcast/Debate/Mission execution entrypoints;
- approval inbox;
- live counts and activity;
- memory/evidence/source/artifact/trace APIs;
- optional token authentication with HTTP-only SameSite cookie;
- same-origin checks on write routes;
- security headers;
- execution disabled by default unless explicitly enabled.

### Interoperability / creative foundations
- protocol-neutral MCP/A2A/ACP envelope contract and JSON adapter;
- configurable research provider adapter;
- provider-neutral CreativeJobService for IMAGE/VIDEO/AUDIO/VOICE/EDIT workflows.

These are **foundations**, not claims of complete native MCP/A2A/ACP protocol implementations or concrete creative provider integrations.

## Current operational configuration

Copy `apps/web/.env.example` to a local environment and configure only the capabilities you intend to enable.

Important controls:
- `POLYON_EXECUTION_ENABLED=false` keeps execution disabled by default.
- `POLYON_APPROVAL_MODE=ASK_EVERYTHING` is the safe default.
- `POLYON_API_TOKEN` enables web authentication.
- model execution requires an explicit model endpoint + model id;
- SMTP requires explicit SMTP host + username and a secret resolver;
- research requires an explicit HTTPS search endpoint + allowlisted hosts.

Never commit credentials or private user data.

## Remaining production work

The core architecture is implemented, but these areas still require real provider/protocol work before calling the whole product production-complete:

1. native MCP/A2A/ACP transports and interoperability negotiation;
2. concrete creative provider adapters and artifact upload/storage workflows;
3. richer multi-step mission planning beyond the initial bounded task bridge;
4. production authentication/session management beyond the local personal-server token mode;
5. richer semantic memory/retrieval if needed;
6. performance/load testing, adversarial E2E testing, backup/restore drills and operational deployment automation.

Do not fake these with placeholder integrations.

## Preferred work loop

1. inspect live branch + CI;
2. choose one coherent production slice;
3. change only needed files;
4. add focused tests;
5. update docs when architecture changes;
6. verify CI;
7. stop at a coherent boundary.

Normal-sized batches only. Never claim CI green without a successful current run.
