# POLYON Chat Handoff

> Compact continuation note for a new ChatGPT conversation.
> Read this together with `AGENTS.md`, `docs/PROJECT-CONTEXT.md`, and `docs/architecture/001-system-architecture.md`.

## Repository state

- Repository: `mohammed-ajmal7/polyon`
- Working branch: `feature/core-architecture`
- Current branch tip: `87e01ec7e95632c2e3b7722639d89204ac1aa36f`
- Latest CI run for the current tip: `36333715864`.
- That run passed install, typecheck, tests, and lint, but failed the format check on this handoff file.
- The repository code/tests are the final source of truth if this file conflicts with implementation.

## What POLYON is

POLYON = **Personal AI Operations Network**.

Tagline: **Many intelligences. One command.**

It is a personal AI operations workspace, not a single chatbot. The human remains the final authority.

Core rules:
- policy before consequential action;
- explicit approval where required;
- provider independence;
- adapter boundaries;
- privacy first;
- deterministic controls;
- traceability/evidence;
- bounded autonomy;
- replaceability;
- zero additional operating cost by default.

Planned external integrations are **only Google Drive, Telegram, and Email**.

## Major foundations already implemented

- Mission, task, execution lifecycle and dependency model.
- Execution policy/approval flow, retries, queueing, cancellation, deadlines, recovery, and durable restart handling.
- File-backed durable storage with versioned migration, atomic persistence, optimistic concurrency, and transactional application writes.
- Agent/model/provider registries and routing boundaries.
- Structured model request/response contracts and provider-independent model gateway.
- Structured model tool calls with bounded agent tool orchestration.
- Durable approval continuations and restart-safe tool checkpoints.
- Governed tool invocation through policy, approval, schema validation, adapter lookup, audit events, and idempotency.
- Root-scoped filesystem read.
- Opt-in bounded terminal execution.
- Structured Git read/write/commit.
- Allowlisted Git publish classified as `PUBLISH/HIGH`; no force/refspec-style arbitrary arguments.
- Governed text artifact creation with durable artifact metadata.
- Durable artifact catalog plus structured `artifact.list.scoped` and `artifact.read.scoped`.
- Bounded model-facing tool output size, including resumed continuations.
- Google Drive concrete bounded integration adapter.
- Telegram concrete bounded outbound integration adapter.
- Bounded outbound HTTP transport and secret-resolution boundary.
- Integration invocation governance and audit tracing.
- Integration reliability work includes cancellation/timeout distinction and typed invocation boundaries.

## Current integration direction

Google Drive and Telegram exist behind integration adapters and the application governance boundary.

Email is **not** implemented yet.

Do not add new external services/providers unless explicitly approved.

## How to continue

Work in **normal-sized slices**, not massive batches.

Preferred loop:
1. Inspect the live branch and current CI.
2. Pick one focused production capability or one concrete failing diagnostic.
3. Change only the necessary files.
4. Add focused tests.
5. Update canonical docs when the architecture changes.
6. Check CI and report the exact status.
7. Stop at a coherent boundary.

Do not create huge speculative frameworks. Prefer small vertical slices that are actually wired end-to-end.

Do not claim CI is green unless the current branch/run proves it.

## Immediate continuation mindset

Before starting new implementation, inspect the latest commits and CI again because the branch may have advanced since this handoff.

The next work should continue the existing production-hardening path. A likely near-term area is completing the Email integration behind the same adapter -> policy/approval -> bounded transport -> durable audit model, but first inspect the current repository because the implementation may have advanced.

## Useful files

- `AGENTS.md` — engineering rules.
- `docs/PROJECT-CONTEXT.md` — canonical product/architecture/roadmap state.
- `docs/architecture/001-system-architecture.md` — architecture rules.
- `packages/contracts` — shared contracts.
- `packages/core` — deterministic domain rules.
- `packages/application` — use cases/governance/orchestration.
- `packages/runtime` — execution runtime/recovery.
- `packages/storage` — persistence.
- `packages/agents` — agents/models/providers.
- `packages/providers` — provider adapters.
- `packages/tools` — governed tool surfaces.
- `packages/integrations` — external integration adapters.
- `apps/web` — UI, still not the finished AI HQ.

## Chat style preference

The owner prefers:
- direct, practical explanations;
- being addressed casually as “Bro”;
- actual repository changes rather than just explanations when asked to continue;
- medium-sized coherent coding batches;
- honest CI/failure reporting;
- no repeated clarification when the repository already contains enough context.
