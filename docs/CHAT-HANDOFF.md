# POLYON Chat Handoff

> Compact continuation note for a new ChatGPT conversation.
> Read this with `AGENTS.md`, `docs/PROJECT-CONTEXT.md`, and
> `docs/architecture/001-system-architecture.md`.

## Current repository state

- Repository: `mohammed-ajmal7/polyon`
- Branch: `feature/core-architecture`
- Latest implementation commit before this note: `039f2a165d43d26e978706fc9dd5d5d0554b7f74`
- The latest CI run before this formatting fix failed only on Prettier.
- Typecheck, tests, and lint passed in that run.
- Always inspect the live branch and latest CI before continuing.

## What POLYON is

POLYON = **Personal AI Operations Network**.

The human remains the final authority. Core rules are:

- policy before consequential action;
- explicit approval where required;
- provider independence;
- adapter boundaries;
- privacy first;
- deterministic controls;
- traceability and evidence;
- bounded autonomy;
- replaceability;
- zero additional operating cost by default.

Planned external integrations are **only Google Drive, Telegram, and Email**.

## Major foundations

Already implemented:

- mission, task, execution lifecycle, dependencies, retries, queueing,
  cancellation, deadlines, recovery, and durable restart handling;
- durable file-backed storage with migrations and transactional writes;
- agent, model, and provider registries;
- provider-independent model gateway;
- governed model tool calls and bounded orchestration;
- durable approval continuations and restart-safe checkpoints;
- governed tool invocation with policy, approval, validation, audit, and
  idempotency;
- scoped filesystem, terminal, Git, artifact, and publish capabilities;
- bounded model-facing tool output;
- Google Drive and Telegram integration adapters;
- bounded outbound HTTP and secret-resolution boundaries;
- integration invocation governance and audit tracing.

## Current Email work

Email now has a provider-neutral adapter boundary in
`packages/integrations/src/email-integration-adapter.ts`.

It provides:

- `SEND_EMAIL`;
- recipient, subject, body, and address validation;
- CRLF/header-injection rejection;
- recipient and body size limits;
- `SMTP_CREDENTIAL` secret-reference enforcement;
- injected `EmailTransport`;
- sanitized transport errors;
- `NON_IDEMPOTENT` and `EXTERNAL_COMMUNICATION` capability metadata.

The adapter is exported and can be explicitly registered by
`createPolyonComposition` only when a secret resolver, email integration
ID, secret reference, and transport are all supplied.

Do **not** call the Email adapter directly from an agent or model.
Execution must continue through the existing integration invocation,
policy, approval, audit, and execution boundaries.

No provider-specific Email SDK has been added.

## Preferred work loop

1. Inspect the live branch and current CI.
2. Pick one focused production capability or concrete failure.
3. Change only the necessary files.
4. Add focused tests.
5. Update canonical docs when architecture changes.
6. Verify CI.
7. Stop at a coherent boundary.

Work in normal-sized slices. Do not create giant speculative batches.

Do not claim CI is green unless the current run proves it.

## Likely next Email slice

Before implementing a concrete SMTP transport, inspect:

- `packages/integrations/src/secret-resolver.ts`;
- all secret resolver implementations and tests;
- `packages/integrations/src/bounded-http-client.ts`;
- Node/TypeScript runtime dependencies and available network primitives;
- Email-related architecture documentation.

The current `SecretResolver` returns a string, while
`SMTP_CREDENTIAL` may need structured host, port, username, password, and
TLS information. Design that boundary carefully before adding transport
code.

Keep Email provider-independent and preserve the existing governance
boundary.

## Chat style

The owner prefers:

- direct, practical explanations;
- casual "Bro" address;
- actual repository changes when asked to continue;
- medium-sized coherent coding batches;
- honest CI and failure reporting;
- no repeated clarification when the repository already contains enough
  context.
