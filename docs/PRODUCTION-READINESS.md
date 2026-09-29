# POLYON Production Readiness

POLYON's foundational controlled operating loop is implemented. The active development/integration line is `develop`; `feature/core-architecture` is retained as the historical architecture baseline.

Current capabilities:

- governed Direct, Broadcast, Debate, and Mission execution;
- durable storage with migrations, transactions, concurrency protection, backup/restore, and restart recovery;
- provider-independent model routing and OpenAI-compatible text execution;
- governed filesystem, terminal, Git, artifact, Google Drive, Telegram, and SMTP Email tooling;
- durable memory/source/evidence, bounded research, synthesis, and privacy-aware context assembly;
- bounded Fact Checker application service over explicit claims and supplied evidence, with deterministic verdict validation and audit trace;
- bounded coding-agent process execution;
- authenticated web APIs and live AI HQ;
- MCP 2026-07-28 HTTP interoperability with subscriptions/listen plus A2A 1.0 HTTP interoperability with streaming task subscriptions and opt-in push notifications;
- automatic semantic indexing with explicit scope allowlisting and durable restart-safe recovery behavior;
- an exact normalized local semantic vector index behind a replaceable boundary, with model/dimension candidate bucketing for lower traversal cost;
- Docker/Compose deployment with CI verification.

## Safety defaults

`POLYON_EXECUTION_ENABLED=false`

`POLYON_APPROVAL_MODE=ASK_EVERYTHING`

`POLYON_API_TOKEN` enables private web/API authentication.

## Remaining production-depth work

1. Advanced MCP/A2A features and broader specification coverage. MCP initialization notifications, bounded `tools/list` pagination, and `subscriptions/listen` are implemented; A2A 1.0 streaming message delivery, bounded task subscriptions, push configuration, durable storage, task-event dispatch, bounded retries, and delivery outcome auditing are implemented. Remaining work is broader protocol specification coverage.
2. Multi-user/enterprise identity and tenancy, outside the personal deployment scope.
3. Sustained load testing, profiling, and broader adversarial E2E coverage beyond the current deterministic production-scale suite.
4. Deployment automation for a specific infrastructure target beyond self-hosted Docker/Compose.

These items do not block the basic self-hosted release workflow when the documented safety defaults, release checklist, and CI gates are satisfied. They remain explicit depth work rather than reasons to claim unsupported protocol or deployment coverage.

Do not fake provider/protocol support to close these items. Keep adapters replaceable.

## Verification

CI performs frozen-lockfile install, typecheck, full tests, lint, formatting, production build, Docker image build, and Compose validation.

Always verify the exact current commit before calling the branch green.
