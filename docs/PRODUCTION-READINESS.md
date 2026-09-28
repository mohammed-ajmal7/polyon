# POLYON Production Readiness

POLYON's foundational controlled operating loop is implemented on `feature/core-architecture`.

Current capabilities:

- governed Direct, Broadcast, Debate, and Mission execution;
- durable storage with migrations, transactions, concurrency protection, backup/restore, and restart recovery;
- provider-independent model routing and OpenAI-compatible text execution;
- governed filesystem, terminal, Git, artifact, Google Drive, Telegram, and SMTP Email tooling;
- durable memory/source/evidence, bounded research, synthesis, and privacy-aware context assembly;
- bounded coding-agent process execution;
- authenticated web APIs and live AI HQ;
- baseline MCP 2026-07-28 and A2A 1.0 HTTP interoperability;
- Docker/Compose deployment with CI verification.

## Safety defaults

`POLYON_EXECUTION_ENABLED=false`

`POLYON_APPROVAL_MODE=ASK_EVERYTHING`

`POLYON_API_TOKEN` enables private web/API authentication.

## Remaining production-depth work

1. Automatic durable indexing/reindex recovery and a replaceable vector acceleration strategy are implemented: semantic indexing can run on startup, and the default exact local vector index caches normalized vectors while preserving an adapter boundary for ANN/pgvector implementations.
2. Advanced MCP/A2A features such as streaming, push, subscriptions, and broader spec coverage; MCP initialization notifications and bounded tool-list pagination are now implemented.
3. Multi-user/enterprise identity and tenancy, outside the personal deployment scope.
4. Production-scale coverage is expanded with deterministic 10k-memory retrieval and 250-item durable restart tests; sustained load testing, profiling, and broader adversarial E2E coverage remain.
5. Deployment automation for a specific infrastructure target beyond self-hosted Docker/Compose.

Do not fake provider/protocol support to close these items. Keep adapters replaceable.

## Verification

CI performs frozen-lockfile install, typecheck, full tests, lint, formatting, production build, Docker image build, and Compose validation.

Always verify the exact current commit before calling the branch green.
