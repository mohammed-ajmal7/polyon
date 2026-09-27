# POLYON Chat Handoff

> Compact continuation note for a new ChatGPT conversation.
> Read this with `AGENTS.md`, `docs/PROJECT-CONTEXT.md`, and
> `docs/architecture/001-system-architecture.md`.

## Current repository state

- Repository: `mohammed-ajmal7/polyon`
- Branch: `feature/core-architecture`
- Latest implementation commit: `dde86d18aa88a9e29488182439f5f123b4e46df4`
- Latest fully verified clean CI remains run **880** on commit
  `145bc37cddfabfba1fc6774518ef6edba1770542`.
- The commits after run 880 have not yet received a CI result through the
  available GitHub workflow-history interface.
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

Email has a provider-neutral adapter boundary in
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

A provider-neutral SMTP transport now exists in
`packages/integrations/src/smtp-email-transport.ts`, with the native Node
socket implementation isolated in `@polyon/runtime`.

SMTP currently has:

- bounded connection and response handling;
- implicit TLS support;
- explicit STARTTLS negotiation;
- multiline SMTP response handling;
- deterministic socket cleanup;
- explicit TLS 1.2 minimum;
- certificate validation enabled explicitly;
- mutual exclusion of implicit TLS and STARTTLS modes;
- message-size enforcement and dot-stuffing.

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

Harden SMTP authentication and failure handling:

- inspect advertised `AUTH` capabilities;
- avoid sending credentials before TLS;
- define supported authentication mechanisms explicitly;
- sanitize authentication failures;
- distinguish transient `4xx` from permanent `5xx` SMTP failures;
- add focused tests without real provider credentials or network access.

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
