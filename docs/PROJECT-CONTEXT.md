# POLYON Project Context & Continuation Guide

> Canonical project handoff document.
>
> Read this file together with `AGENTS.md`, `docs/CHAT-HANDOFF.md`, and the repository code before continuing development.

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

### Collaborative

Collaborative mode is the first multi-agent collective workflow. POLYON sends a request to a bounded team of active agents in parallel, preserves each attributable contribution, and asks a designated synthesis agent to compare the findings into one transparent response. Contributor failures are recorded without discarding successful work. The workflow is intentionally non-acting: consequential tool and integration work remains behind the existing policy and approval paths.

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

A concrete bounded filesystem-read tool, an opt-in scoped terminal execution tool, and structured scoped Git read/write tools now exist behind the tool adapter boundary. The terminal tool requires an explicit command allowlist, keeps execution inside a configured root, disables shell interpretation, enforces timeout/output limits, and passes only an explicit environment-variable allowlist to the child process. Git read operations are limited to STATUS/DIFF/LOG/SHOW. Git write operations are limited to CREATE_BRANCH/STAGE_PATHS/UNSTAGE_PATHS and are classified as WRITE so normal policy/approval controls apply. The application-level ToolInvocationService enforces tool lookup, policy decisions, approvals, invocation tracing, input-schema validation, and adapter execution. Model-facing tool definitions carry the declared input schema and use provider-safe function names while preserving the canonical POLYON tool ID for routing and audit. Git commit/publish is now partially implemented with separate bounded tools: structured local commit is a governed WRITE operation, and remote publish is a governed PUBLISH operation with an explicit remote allowlist and safe branch/ref construction. Artifact text creation is a governed WRITE tool whose returned metadata is durably registered and traced; the application also exposes a deterministic artifact catalog for metadata queries and an explicitly configured bounded local artifact-content reader that resolves artifact locations only within its configured root. Agent tool catalogs can discover these as structured `artifact.list.scoped` and `artifact.read.scoped` READ tools when the corresponding capabilities are configured. Model-facing tool results are bounded by a configurable byte limit, including resumed approval continuations, while durable tool results remain intact. Google Drive, Telegram, and Email now have concrete integration adapters. They are agent-callable through the dynamic model-tool catalog and route through the single integration invocation/policy boundary. Their approval continuations are durably checkpointed; non-idempotent external work is never automatically replayed after an ambiguous restart and instead enters human reconciliation. Email SEND_EMAIL is implemented behind a provider-neutral SMTP transport with secret resolution, TLS/STARTTLS, AUTH LOGIN, bounded MIME/data handling, sanitized SMTP error classification, and protocol/header safety limits.

### Conversations and application ingress

Implemented application-level foundations include:

- Direct/Broadcast/Collaborative/Research/Debate/Deep Analysis/Mission command ingress;
- conversation creation/validation;
- participant validation;
- message persistence;
- domain event emission;
- conversation snapshot querying;
- conversation event trace retrieval.

### Debate domain

The debate domain and bounded multi-agent debate runtime are implemented, including:

- debate creation;
- phase transitions;
- final-round validation;
- adjudication-state validation;
- cancellation;
- decision handling;
- bounded multi-agent proposal, criticism, evidence, rebuttal, and adjudication runtime;
- durable contribution and decision traces;
- restart-safe persisted debate recovery;
- deep-analysis orchestration combining collective analysis and bounded debate.

The debate runtime operates behind the provider-independent agent gateway and durable storage boundaries.

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

## 6. Current production-readiness status

The foundational POLYON operating loop is implemented and connected end-to-end.

Implemented:

- governed Direct, Broadcast, Debate, and Mission execution;
- durable execution queue/recovery, retries, cancellation, deadlines, result publication, and audit traces;
- provider-independent model gateway plus OpenAI-compatible text execution;
- bounded coding-agent process and coding tool profile;
- Google Drive, Telegram, Email/SMTP integrations;
- durable memory/source/evidence, bounded web research, synthesis, privacy-aware context assembly, and governed memory writes;
- configurable creative HTTP adapter exposed through governed creative tooling;
- authenticated browser APIs, login/logout, approval inbox, trace, memory/evidence/source/artifact APIs;
- MCP HTTP baseline with current stateless routing-header validation and tools/discovery/call support;
- A2A HTTP baseline with agent card, SendMessage, GetTask, ListTasks;
- Docker/Compose deployment, liveness healthcheck, root Docker context exclusions, and CI image/Compose validation;
- adversarial, recovery, and volume sanity coverage across application/runtime/storage/security paths.

Remaining depth:

- provider-independent embedding routing, bounded persisted semantic memory search, and durable automatic indexing/reindex scheduling are implemented; vector-scale optimization remains.
- advanced MCP/A2A protocol capabilities;
- optional enterprise/multi-user auth;
- production-scale performance and broader E2E testing;
- deployment automation for a specific infrastructure target.

The code and tests remain authoritative over this summary.

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

Status: implemented as a bounded multi-agent runtime. The integrated Deep Analysis flow now combines collective analysis, bounded challenge, finite debate, and adjudication:

- participant selection;
- proposal;
- criticism;
- evidence requests;
- rebuttal;
- adjudication;
- finite termination;
- decision artifact;
- durable contribution/decision trace;
- restart-safe recovery.

### Phase 8 — Coding agents and sandboxed execution

Add coding-agent adapters, isolated execution, Git operations, artifacts, and recovery.

### Phase 9 — External integrations

Status: in progress.

Implemented:

- Google Drive READ adapter;
- Telegram bounded SEND_MESSAGE adapter.

Remaining:

- Email;
- production credential lifecycle beyond environment-backed secret references.

Build authentication and secret storage without exposing credentials to the browser.

### Phase 10 — Memory / knowledge

Add context assembly, long-term memory, evidence retrieval, and privacy-aware knowledge handling.

### Phase 11 — AI HQ web interface

Status: implemented for the first release candidate.

The current workspace includes Command, Missions, Executions, Approvals, Agents, Memory, Research, Evidence, Artifacts, Activity, and Settings views around the stable application APIs. Further UX refinement can continue after the release candidate.

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
> The GitHub repository is `mohammed-ajmal7/polyon`, with `develop` as the active integration branch.
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

The repository is actively developed on `develop`; `feature/core-architecture` is retained as the historical architecture baseline.

The codebase now contains durable persistence, governed execution, provider-independent model routing, multi-agent collective orchestration, bounded debate/deep-analysis runtime, tools/integrations, research/evidence, semantic memory, interoperability baselines, and the AI HQ web workspace needed for the first self-hosted release candidate. The remaining pre-release work is primarily deployment validation, real-configuration startup smoke testing, backup/restore verification, and release branching.

The exact implementation state must always be re-read from the repository before continuing. Do not rely on this paragraph as a substitute for inspecting the current code, tests, and git history.

This document describes the intended architecture, roadmap, and continuation procedure; the repository code and tests remain the final source of truth.
