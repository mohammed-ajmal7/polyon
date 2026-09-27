# POLYON Project Context & Continuation Guide

> Canonical project handoff document.
>
> Read this file together with `AGENTS.md` and the repository code before continuing development.

## 1. What we are building

POLYON means **Personal AI Operations Network**.

Tagline:

> **Many intelligences. One command.**

POLYON is a serious personal AI workspace / AI HQ. The goal is not to build one chatbot. The goal is to build a system where one human can coordinate many AI agents, models, tools, research systems, coding agents, creative systems, and local intelligence from one command center.

The human remains the final authority.

The product should eventually let the user:

- talk to one agent;
- broadcast the same request to many agents;
- run bounded, evidence-based debates between agents;
- turn a larger objective into a mission, plan, tasks, and controlled execution;
- let agents use approved tools;
- route work between different models/providers without coupling the core system to a provider;
- keep sensitive work in a private/local lane when policy requires it;
- execute coding, research, communication, file, and creative workflows;
- inspect what happened, why it happened, what evidence was used, and what was executed;
- pause, resume, retry, reject, or approve consequential work.

The product should behave like a personal operations headquarters rather than a single assistant.

## 2. Non-negotiable principles

These are architectural rules, not suggestions.

### Human authority

The user is always the final authority for consequential actions.

### Policy before action

An agent must not bypass policy/approval controls for consequential work.

### Provider independence

Core business logic must not depend directly on OpenAI, Anthropic, Google, Ollama, a specific CLI, or any other model/provider.

### Adapter boundaries

Model providers, tools, and external integrations are accessed through explicit interfaces/adapters.

### Privacy first

Sensitive information should stay inside the local/private execution lane whenever possible. Cloud data transfer must be policy-controlled.

### Evidence and traceability

Important actions and decisions must be reconstructable: request, participants, evidence, decisions, approvals, tools, execution, and resulting artifacts.

### Deterministic controls

Permissions, validation, state transitions, routing requirements, and safety controls should be enforced by software rather than by prompts alone.

### Replaceability

Models, providers, runtimes, databases, storage implementations, integrations, and execution environments must remain replaceable.

### Bounded autonomy

Autonomous behavior must have explicit scope, limits, and termination conditions.

### Zero additional operating cost by default

Do not introduce paid APIs/services unless the project owner explicitly approves them.

### Planned external integrations

Only these external integrations are currently in scope:

- Google Drive
- Telegram
- Email

Do not add other external integrations without explicit approval.

## 3. Primary interaction modes

### Direct

One user request goes to one selected agent/model.

```
User -> Agent -> Tools/Models -> User
```

### Broadcast

One user request is independently sent to multiple agents.

```
                 -> Agent A
User -> Request -> Agent B
                 -> Agent C
```

Results remain separately attributable.

### Debate

A finite structured process:

```
Proposal
  -> Criticism
  -> Evidence
  -> Rebuttal
  -> Adjudication
  -> Decision
```

Debates must be bounded by limits such as rounds, participants, time, and resources. The final result must not simply be a majority vote.

### Mission

A larger objective becomes structured executable work:

```
User
  -> Mission
  -> Plan
  -> Tasks
  -> Authorization / Approval
  -> Queue
  -> Runtime
  -> Results / Artifacts / Evidence
```

## 4. Current architecture

Major areas:

```
POLYON
|
+-- Web / User Experience
|
+-- Application Layer
|
+-- Core Domain
|
+-- Agent System
|
+-- Policy & Approval
|
+-- Orchestration / Runtime
|
+-- Model & Provider Adapters
|
+-- Tool & Integration Adapters
|
+-- Memory & Knowledge
|
+-- Storage
|
+-- Execution / Sandbox
|
+-- Observability / Evidence
```

Current monorepo packages:

- `@polyon/contracts` — shared domain contracts/types.
- `@polyon/core` — technology-independent domain rules and state transitions.
- `@polyon/application` — application services/use cases.
- `@polyon/runtime` — execution queue/coordinator/runner boundaries.
- `@polyon/storage` — storage interfaces and in-memory implementations.
- `@polyon/agents` — agent/model/provider registries and routing.
- `@polyon/providers` — model provider adapter boundary.
- `@polyon/tools` — tool contracts, registry, and tool adapter boundary.
- `@polyon/integrations` — external integration adapter boundary.
- `apps/web` — Next.js web application; UI is intentionally behind the domain foundation.

## 5. What has already been built

The repository has already moved well past the initial skeleton.

### Contracts

Core contracts exist for actors, agents, capabilities, models, providers, missions, tasks, executions, policies, risk/actions, approvals, conversations, messages, evidence, artifacts, tools, and domain events.

### Mission/task domain

Implemented foundations include:

- mission/task lifecycle rules;
- task dependencies;
- task readiness;
- dependency graph validation;
- cycle detection;
- mission plan proposal creation;
- mission plan validation;
- approved plan application;
- rejection/invalid-transition handling;
- explicit retry creation;
- task/execution state synchronization.

### Execution governance

Implemented foundations include:

- execution creation;
- execution attempt validation;
- execution lifecycle transitions;
- start/pause/resume/cancel/complete/reject controls;
- failure outcomes;
- execution retry creation;
- execution-run policy authorization;
- approval request creation for executions;
- applying approved execution authorization;
- queue boundary;
- execution coordinator boundary;
- runner result handling;
- fail-closed coordinator behavior;
- persistence synchronization through application/storage layers.

### Agent/model/provider system

Implemented boundaries include:

- agent registry;
- model registry;
- provider registry;
- model routing;
- preferred model plus compatible fallback routing;
- provider-enabled checks;
- active-agent checks;
- provider adapter interface;
- provider adapter registry.

The actual real provider implementations are intentionally not coupled into the core.

### Tools/integrations

Implemented boundaries include:

- tool contracts;
- tool registry;
- tool adapter interface/registry;
- integration adapter interface/registry;
- planned integration kinds for Google Drive, Telegram, and Email.

A concrete bounded filesystem-read tool, an opt-in scoped terminal execution tool, and structured scoped Git read/write tools now exist behind the tool adapter boundary. The terminal tool requires an explicit command allowlist, keeps execution inside a configured root, disables shell interpretation, enforces timeout/output limits, and passes only an explicit environment-variable allowlist to the child process. Git read operations are limited to STATUS/DIFF/LOG/SHOW. Git write operations are limited to CREATE_BRANCH/STAGE_PATHS/UNSTAGE_PATHS and are classified as WRITE so normal policy/approval controls apply. The application-level ToolInvocationService enforces tool lookup, policy decisions, approvals, invocation tracing, input-schema validation, and adapter execution. Model-facing tool definitions carry the declared input schema and use provider-safe function names while preserving the canonical POLYON tool ID for routing and audit. Git commit/publish and network access remain to be implemented; bounded artifact text creation now exists as a governed WRITE tool and its returned metadata is durably registered and traced. External integrations remain to be implemented.

### Conversations and application ingress

Implemented application-level foundations include:

- Direct/Broadcast/Debate/Mission command ingress;
- conversation creation/validation;
- participant validation;
- message persistence;
- domain event emission;
- conversation snapshot querying;
- conversation event trace retrieval.

### Debate domain

A bounded debate domain has been started, including:

- debate creation;
- phase transitions;
- final-round validation;
- adjudication-state validation;
- cancellation;
- decision handling.

This is a domain foundation, not yet the complete multi-agent debate runtime.

### Quality infrastructure

The repository contains:

- pnpm workspace;
- Turborepo;
- TypeScript;
- Vitest;
- ESLint;
- Prettier;
- CI workflow/quality gates;
- architecture documentation;
- agent instructions.

Do not claim the complete production system is already finished. The work so far is the foundation.

## 6. What is NOT finished yet

The remaining work is substantial.

The most important missing layers include:

### Real application/runtime execution

The current execution system has boundaries and in-memory implementations plus a restart-safe runtime bootstrap. It still needs production-grade orchestration connecting:

- accepted commands;
- mission planning;
- agent selection;
- model routing;
- tool calls;
- provider calls;
- approvals;
- queueing;
- execution;
- output collection;
- retries;
- cancellation;
- durable persistence.

### Real model/provider adapters

The provider adapter boundary exists. Concrete adapters still need to be added and tested.

The provider layer now also has a reliability and invocation boundary: text-model requests use a structured message/request/response contract; model invocations accept cancellation signals, support explicit timeouts, normalize adapter failures into typed provider invocation errors, and can retry only failures explicitly classified as retryable. These controls are exposed through AgentGateway without coupling agents to a concrete provider.

A concrete OpenAI-compatible HTTP text-model adapter now implements that boundary without adding a provider SDK dependency. It accepts an explicit endpoint and optional API key, maps common HTTP failures into the provider error taxonomy, and normalizes text responses and token usage. The runtime also has a model-backed execution runner that loads the persisted task, builds the structured text request, invokes the execution's bound model, and returns the normalized model output or a failed runtime result.


The architecture should permit hosted models, local models, CLI agents, and remote agents without embedding their assumptions into core.

### Real tool execution

The governed tool invocation path is now implemented for the current filesystem-read capability. The application validates the tool, evaluates policy, persists approval/decision state when required, executes the registered adapter, and records invocation events. The composition root exposes this service as the single application entry point.

Broader consequential tool categories still need concrete adapters and end-to-end agent integration.

Important future tool categories include:

- filesystem;
- terminal;
- network;
- Git;
- artifact handling;
- communication.

Every consequential tool action must pass policy/approval controls.

### Real external integrations

Google Drive, Telegram, and Email need concrete adapters and authentication/token handling.

Secrets must never be exposed to the web client or committed to Git.

### Durable storage

A zero-dependency local file-backed persistence implementation now exists behind the existing storage interfaces.

The implementation provides:

- versioned JSON snapshots;
- atomic temp-file replacement;
- filesystem synchronization before commit;
- restart/reopen persistence;
- persisted event traces;
- fail-closed handling for malformed or unsupported snapshots;
- duplicate-identity protection after recovery.

The current durable backend is intentionally a replaceable adapter rather than a commitment to one database technology. Durable snapshots now have a formal versioned migration pipeline: supported migrations are applied sequentially on open, validated against the current schema version, and persisted through the same atomic commit boundary. Future-version snapshots and missing/ambiguous migration paths fail closed.

A storage-level unit-of-work boundary is now available. File-backed domain stores stage changes against a complete domain snapshot and commit them with one atomic filesystem replacement; in-memory stores provide rollback semantics for tests.

The main cross-store application write paths are now transaction-aware:

- command ingress;
- mission creation;
- mission plan submission and approval resolution;
- mission lifecycle transitions/progress sync;
- execution dispatch and execution approval resolution;
- execution result/message/artifact publication.

Runtime queueing remains outside the storage transaction because it is an external runtime side effect. The runtime now provides idempotent queue insertion, recovery of persisted QUEUED executions into a fresh in-memory queue, and a continuous execution loop with configurable polling and bounded concurrency. Automatic scheduling remains deterministic FIFO through the queue; the default concurrency is one, while higher limits can be supplied explicitly. The runtime also supports cooperative cancellation and execution deadlines; cancellation persists execution/task state and propagates through AbortSignal, while a deadline is recorded as a failed execution. Runtime health is exposed directly, and transient coordination failures use bounded exponential backoff before retrying the persisted QUEUED execution. Runtime-level backoff retries do not create new execution attempts; governed attempt retries remain an application/core responsibility.

Durable storage now has optimistic concurrency protection. File-backed writes carry a SHA-256 snapshot revision; stale direct writes and stale transactions are rejected instead of overwriting newer state. The final filesystem replacement is guarded by an atomic lock, with stale-lock recovery for crashes during the short commit window. Concurrency tests cover stale writers, transactions becoming stale during work, nested transaction rejection, and stale lock recovery.

The Phase 3 recovery target is now covered by the current runtime/storage implementation and integration tests:

- durable queued execution recovery across process restart;
- multi-execution recovery in persisted FIFO order;
- idempotent recovery trace events;
- runtime recovery/queue health signals including recovered counts, queue depth, active work, last recovery, errors, and retry backoff.

Persistence must support recovery and traceability without coupling the application to one database forever.

### Memory and knowledge

A complete memory/knowledge system is still needed for:

- short-term execution context;
- long-term user/project memory;
- retrieval;
- evidence;
- source attribution;
- privacy boundaries;
- context assembly.

### Research system

The research department still needs:

- web/source retrieval;
- evidence records;
- source normalization;
- citation/attribution;
- claim/evidence relationships;
- research task orchestration;
- final synthesis.

### Creative system

The creative department still needs adapters/workflows for image, video, audio, voice, editing, and artifact handling.

### Coding-agent system

The architecture is intended to support coding agents such as CLI/agent runtimes later. The concrete integrations and sandboxed execution model are still to be built.

### MCP / A2A / ACP connectivity

The architectural direction is:

- MCP for agent -> tool/data access;
- A2A-style boundaries for agent -> agent collaboration;
- ACP-style boundaries for coding-agent interoperability.

These should be introduced behind replaceable interfaces, not hard-coded into the core domain.

### Web UI / AI HQ

The current Next.js application is not yet the finished POLYON interface.

The final UI should expose:

- command center;
- agent selection;
- broadcast;
- debate;
- mission creation;
- task graph;
- approval inbox;
- execution queue;
- live execution status;
- evidence;
- artifacts;
- conversation history;
- policy/permission settings;
- private/cloud execution lane visibility;
- observability and traces.

## 7. Target end-to-end behavior

A typical future Mission should behave approximately like this:

```
1. User enters a goal
        |
2. Command ingress records the request
        |
3. Application creates/loads the conversation or mission
        |
4. Planning agents propose a structured plan
        |
5. Plan is validated by deterministic domain rules
        |
6. User reviews/approves the plan when required
        |
7. Each ready task receives an execution attempt
        |
8. Policy evaluates the requested action/risk
        |
9. ALLOW      -> queue
   APPROVAL   -> approval inbox -> queue after approval
   DENY       -> stop
        |
10. Agent/model router selects a compatible model/provider
        |
11. Runtime starts execution
        |
12. Agent may call approved tools
        |
13. Tool calls go through adapters and policy controls
        |
14. Outputs become messages/artifacts/evidence
        |
15. State/events are persisted
        |
16. Failed work can be retried using a new attempt
        |
17. User sees the complete trace/result
```

## 8. Development roadmap

This is the intended order. Do not randomly jump to UI polish while the execution foundation is incomplete.

### Phase 1 — Domain foundation

Status: substantially built.

Finish hardening:

- contracts;
- state machines;
- policy;
- approval;
- mission/task graph;
- execution lifecycle;
- debate lifecycle;
- invariants;
- exhaustive tests.

### Phase 2 — Application orchestration

Status: in progress.

Build complete use cases around the current domain:

- command intake;
- mission creation;
- plan handling;
- approval handling;
- task dispatch;
- execution coordination;
- result persistence;
- conversation updates;
- domain event generation.

The application layer should orchestrate packages rather than duplicate domain rules. A mission task orchestration service now re-evaluates persisted task dependencies after progress changes, marks newly eligible PENDING/BLOCKED tasks READY using the core readiness rules, and records the transition atomically. It intentionally stops at READY; execution dispatch remains a separate policy/approval-aware step.

### Phase 3 — Durable persistence

Introduce concrete durable storage behind the existing storage interfaces.

Requirements:

- crash recovery;
- idempotency;
- atomic updates where required;
- trace/event persistence;
- migration strategy;
- testable repository boundaries.

### Phase 4 — Real agent/model/provider execution

Implement concrete provider adapters and agent runtime adapters.

Requirements:

- provider-independent application API;
- preferred/fallback model routing;
- timeouts;
- cancellation;
- explicit failure classification;
- retry policy;
- rate/error handling;
- private/local lane controls.

### Phase 5 — Governed tool execution

Status: governed filesystem-read execution and bounded agent-driven tool orchestration are implemented. Tool approvals persist durable continuation checkpoints, pause the execution/task, and re-queue the execution after approval. Approved tool results are checkpointed transactionally with their success audit before the resumed model call, and subsequent resumed model/tool rounds use the active approval as a durable checkpoint anchor. Startup recovery now distinguishes an interrupted approved continuation from an interrupted pending approval: approved work is re-queued, while a pending approval is recovered to PAUSED so the human gate is never bypassed.

The current governed tool invocation path is:

```
Agent request
 -> Tool lookup
 -> Policy evaluation
 -> Approval when required
 -> Tool adapter
 -> Tool result
 -> Event/evidence/artifact persistence
```

No consequential tool may bypass this path.

### Phase 6 — Research + evidence

Build the research department with evidence-first output and traceability.

### Phase 7 — Debate runtime

Connect the bounded debate domain to actual multi-agent execution:

- participant selection;
- proposal;
- criticism;
- evidence requests;
- rebuttal;
- adjudication;
- finite termination;
- decision artifact;
- user approval for consequential decisions.

### Phase 8 — Coding agents and sandboxed execution

Add coding-agent adapters, isolated execution, Git operations, artifacts, and recovery.

### Phase 9 — External integrations

Implement only:

- Google Drive;
- Telegram;
- Email.

Build authentication and secret storage without exposing credentials to the browser.

### Phase 10 — Memory / knowledge

Add context assembly, long-term memory, evidence retrieval, and privacy-aware knowledge handling.

### Phase 11 — AI HQ web interface

Build the finished Next.js product around the stable application APIs.

### Phase 12 — Observability, security, evals, hardening

Before calling POLYON production-ready:

- structured logs;
- trace IDs;
- execution history;
- audit trail;
- security review;
- permission tests;
- failure recovery;
- end-to-end tests;
- adversarial tests;
- cost controls;
- privacy tests;
- provider replacement tests;
- performance testing.

## 9. How another AI should continue this project

A new chat does not need the old conversation transcript if it has the repository.

It should treat these sources as authoritative, in this order:

1. Repository code.
2. `AGENTS.md`.
3. This `docs/PROJECT-CONTEXT.md`.
4. `docs/architecture/001-system-architecture.md`.
5. Tests and existing package contracts.
6. Git history when useful for intent.

The next AI must inspect the current repository state before choosing work. Do not assume that an older conversation's "next step" is still correct.

### Required continuation behavior

1. Read `AGENTS.md`.
2. Read `docs/PROJECT-CONTEXT.md`.
3. Read the relevant architecture section.
4. Inspect the current package/code state.
5. Identify the highest-value missing vertical slice in the roadmap.
6. Preserve existing boundaries and invariants.
7. Make small, coherent changes.
8. Add or update tests for every behavior change.
9. Format/lint/typecheck/test the changed work when the environment permits.
10. Inspect the resulting diff.
11. Commit coherent changes with descriptive commit messages.
12. Report exactly what changed and what is still unverified.

Do not rewrite the architecture from scratch merely because another approach is familiar.

Do not introduce a dependency just because it is convenient.

Do not replace working abstractions with provider-specific code.

Do not silently weaken approval, policy, privacy, or audit requirements.

## 10. The one prompt to give a new AI

Use this when opening a new chat:

> We are continuing development of POLYON, a serious personal AI Operations Network.
>
> First read `AGENTS.md`, `docs/PROJECT-CONTEXT.md`, and `docs/architecture/001-system-architecture.md`.
>
> The GitHub repository is `mohammed-ajmal7/polyon`, branch `feature/core-architecture`.
>
> Treat the repository and these documents as the source of truth, not the previous chat transcript.
>
> Inspect the current code and git history before making decisions.
>
> Understand the existing contracts, core domain, application layer, runtime, storage, agents, providers, tools, integrations, conversation ingress, and debate foundations.
>
> Continue the project from its actual current state. Do not start over, do not invent missing architecture, and do not ask me to paste repository files when the repository can be inspected directly.
>
> Follow the roadmap in `docs/PROJECT-CONTEXT.md` and choose the next coherent implementation slice. Preserve human authority, policy/approval enforcement, privacy, provider independence, replaceability, traceability, and zero-cost-by-default constraints.
>
> Make the code changes, add tests, validate them, commit them, and then tell me exactly what was completed and what remains.

## 11. Definition of "done"

POLYON is not done when the UI can send a prompt to an LLM.

POLYON is done when the complete controlled operating loop works reliably:

```
Human intent
 -> governed planning
 -> multi-agent collaboration
 -> evidence
 -> explicit authorization
 -> tool/model execution
 -> durable state
 -> artifacts/results
 -> traceability
 -> recovery
```

The system must remain understandable, testable, replaceable, private by default, and under human control.

---

## Current project status note

The repository is actively under development on `feature/core-architecture`.

The codebase currently includes the Phase 3 durable-storage foundation and the beginning of Phase 4 real-intelligence execution work. In particular, durable file-backed storage, transactional application write paths, restart-safe execution queue recovery, result replay idempotency, formal snapshot migrations, optimistic concurrency protection, provider invocation reliability controls, a concrete OpenAI-compatible text-model adapter, and a model-backed execution runner have been implemented.

The exact implementation state must always be re-read from the repository before continuing. Do not rely on this paragraph as a substitute for inspecting the current code, tests, and git history.

This document describes the intended architecture, roadmap, and continuation procedure; the repository code and tests remain the final source of truth.
